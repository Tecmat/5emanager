import {
  applyCampaignAction,
  DEFAULT_HOUSE_RULES,
  type Campaign,
  type ClientAction,
  type PlayerInfo,
  type Registry,
} from '@dnd5e/core';

/**
 * Modalità P2P: un dispositivo (anche smartphone con hotspot) fa da HOST della campagna
 * direttamente dall'app, via WebRTC DataChannel — niente server, niente dominio.
 * Signaling manuale: il joiner genera un "offer" (codice), l'host risponde con un "answer".
 * I messaggi sono gli stessi del server WS (join/welcome/state/action/error/pong/campaignDeleted).
 */

const PREFIX = '5EP2P1:';

export function encodeBlob(sdp: RTCSessionDescriptionInit): string {
  return PREFIX + btoa(JSON.stringify(sdp));
}

export function decodeBlob(blob: string): RTCSessionDescriptionInit {
  if (!blob.trim().startsWith(PREFIX)) throw new Error('Codice non valido (manca il prefisso ' + PREFIX + ')');
  return JSON.parse(atob(blob.trim().slice(PREFIX.length))) as RTCSessionDescriptionInit;
}

function waitIce(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const to = setTimeout(() => resolve(), timeoutMs);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(to); resolve(); }
    });
  });
}

interface HostCallbacks {
  onMessage: (m: any, fromPlayerId?: string) => void;
  onState: (campaign: Campaign) => void;
  onPeerJoined: (p: PlayerInfo) => void;
  onPeerLeft: (playerId: string) => void;
}

type AnyMsg = Record<string, any>;

export class P2PHost {
  campaign: Campaign;
  reg: Registry;
  private peers = new Map<string, RTCDataChannel>(); // playerId -> channel
  private pending = new Map<RTCDataChannel, string>(); // channel -> peer key prima del join
  private cb: HostCallbacks;
  private nextPeer = 0;

  constructor(opts: { campaignName: string; password: string; masterName: string; reg: Registry; cb: HostCallbacks }) {
    this.reg = opts.reg;
    this.cb = opts.cb;
    const master: PlayerInfo = { id: 'host-' + Math.random().toString(36).slice(2, 8), name: opts.masterName || 'Master', role: 'master' };
    this.campaign = {
      id: Math.random().toString(36).slice(2, 10),
      name: opts.campaignName || 'Campagna P2P',
      passwordHash: opts.password, // in memoria, confrontata in chiaro (la campagna P2P è effimera)
      houseRules: { ...DEFAULT_HOUSE_RULES },
      custom: {},
      players: [master],
      characters: {},
      combat: null,
      groupInventory: [],
      groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.masterId = master.id;
  }

  masterId: string;

  /** l'host riceve l'offer del joiner e produce l'answer da ridargli */
  async handleOffer(offerBlob: string): Promise<string> {
    const pc = new RTCPeerConnection();
    const key = 'peer-' + this.nextPeer++;
    pc.ondatachannel = (ev) => this.attachChannel(key, ev.channel);
    await pc.setRemoteDescription(decodeBlob(offerBlob));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIce(pc);
    return encodeBlob(pc.localDescription!.toJSON());
  }

  private attachChannel(key: string, ch: RTCDataChannel) {
    this.pending.set(ch, key);
    ch.onmessage = (ev) => {
      let msg: AnyMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const playerId = [...this.peers.entries()].find(([, c]) => c === ch)?.[0];
      this.handlePeerMessage(ch, playerId, msg);
    };
    ch.onclose = () => {
      const playerId = [...this.peers.entries()].find(([, c]) => c === ch)?.[0];
      if (playerId) {
        this.peers.delete(playerId);
        this.campaign.players = this.campaign.players.filter((p) => p.id !== playerId);
        this.cb.onPeerLeft(playerId);
        this.broadcastState();
      }
      this.pending.delete(ch);
    };
  }

  private handlePeerMessage(ch: RTCDataChannel, playerId: string | undefined, msg: AnyMsg) {
    if (msg.t === 'join') {
      if (msg.password !== this.campaign.passwordHash) {
        ch.send(JSON.stringify({ t: 'error', message: 'Password sbagliata' }));
        return;
      }
      if (this.campaign.players.some((p) => p.name.toLowerCase() === String(msg.name).toLowerCase())) {
        ch.send(JSON.stringify({ t: 'error', message: 'Nome già in uso in questa campagna' }));
        return;
      }
      const player: PlayerInfo = { id: 'p2p-' + Math.random().toString(36).slice(2, 8), name: String(msg.name || 'Giocatore'), role: 'player' };
      this.campaign.players.push(player);
      this.peers.set(player.id, ch);
      this.pending.delete(ch);
      ch.send(JSON.stringify({ t: 'welcome', you: player, campaign: this.campaign }));
      this.cb.onPeerJoined(player);
      this.broadcastState();
      return;
    }
    if (msg.t === 'ping') {
      ch.send(JSON.stringify({ t: 'pong', id: msg.id, serverTime: Date.now() }));
      return;
    }
    if (playerId && msg.t === 'action') {
      this.applyAction(playerId, msg.action as ClientAction);
    }
  }

  /** applica un'azione (da un peer o dall'host stesso) e broadcasta lo stato */
  applyAction(playerId: string, action: ClientAction): void {
    if (action.kind === 'deleteCampaign') {
      this.broadcast({ t: 'campaignDeleted', id: this.campaign.id });
      return;
    }
    const [next, err] = applyCampaignAction(this.campaign, playerId, this.reg, action);
    if (err) {
      const ch = this.peers.get(playerId);
      ch?.send(JSON.stringify({ t: 'error', message: err }));
      return;
    }
    this.campaign = next;
    this.campaign.updatedAt = new Date().toISOString();
    this.broadcastState();
  }

  /** invia un messaggio dal "server" (host) a un singolo peer */
  sendTo(playerId: string, m: AnyMsg): void {
    this.peers.get(playerId)?.send(JSON.stringify(m));
  }

  broadcast(m: AnyMsg): void {
    const s = JSON.stringify(m);
    for (const ch of this.peers.values()) if (ch.readyState === 'open') ch.send(s);
  }

  broadcastState(): void {
    this.broadcast({ t: 'state', campaign: this.campaign });
    this.cb.onState(this.campaign);
  }

  peerList(): PlayerInfo[] {
    return this.campaign.players;
  }
}

export class P2PClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  onMessage: (m: any) => void = () => {};
  onOpen: () => void = () => {};

  /** il joiner crea l'offer (codice da dare all'host) */
  async createOffer(): Promise<string> {
    this.pc = new RTCPeerConnection();
    this.dc = this.pc.createDataChannel('game');
    this.dc.onmessage = (ev) => {
      try { this.onMessage(JSON.parse(ev.data)); } catch { /* ignora */ }
    };
    this.dc.onopen = () => this.onOpen();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitIce(this.pc);
    return encodeBlob(this.pc.localDescription!.toJSON());
  }

  /** il joiner incolla l'answer dell'host e apre il canale */
  async acceptAnswer(answerBlob: string): Promise<void> {
    if (!this.pc) throw new Error('Prima genera il codice invito (offer)');
    await this.pc.setRemoteDescription(decodeBlob(answerBlob));
  }

  send(m: AnyMsg): void {
    if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(m));
  }

  get open(): boolean {
    return !!this.dc && this.dc.readyState === 'open';
  }

  close(): void {
    this.dc?.close();
    this.pc?.close();
    this.dc = null;
    this.pc = null;
  }
}
