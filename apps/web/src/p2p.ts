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
 *
 * Flusso semplificato (v2):
 *  1. l'HOST genera un "codice invito" (offer WebRTC) — lo mostra come testo/QR e lo condivide;
 *  2. il giocatore incolla/scansiona l'invito e genera la "risposta" (answer);
 *  3. l'host incolla/scansiona la risposta → il canale si apre.
 * Se un server 5emanager è raggiungibile sulla rete, gli host si annunciano lì (P2PDiscovery)
 * e i giocatori vedono la lista delle campagne e si uniscono con un click (il server fa solo
 * da relay dei codici SDP, il traffico di gioco resta P2P diretto).
 *
 * I messaggi di gioco sono gli stessi del server WS (join/welcome/state/action/error/pong/campaignDeleted).
 */

const PREFIX = '5EP2P1:';

/** WebRTC disponibile? Su WebKitGTK (AppImage Linux) spesso RTCPeerConnection manca: il P2P diretto non funziona lì */
export function webrtcSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

const NO_WEBRTC = 'WebRTC non supportato in questo ambiente (RTCPeerConnection mancante — es. AppImage su WebKitGTK): usa la modalità 🌐 server remoto';

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function encodeBlob(sdp: RTCSessionDescriptionInit): string {
  return PREFIX + b64urlEncode(JSON.stringify(sdp));
}

export function decodeBlob(blob: string): RTCSessionDescriptionInit {
  const t = blob.trim();
  if (!t.startsWith(PREFIX)) throw new Error('Codice non valido (manca il prefisso ' + PREFIX + ')');
  return JSON.parse(b64urlDecode(t.slice(PREFIX.length))) as RTCSessionDescriptionInit;
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
  private pending = new Map<string, RTCPeerConnection>(); // inviteKey -> pc in attesa di answer
  private cb: HostCallbacks;
  private nextInvite = 0;

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

  /**
   * l'host crea un nuovo invito: ritorna { key, code }.
   * `code` è l'offer da dare al giocatore (testo o QR).
   */
  async createInvite(): Promise<{ key: string; code: string }> {
    if (!webrtcSupported()) throw new Error(NO_WEBRTC);
    const key = 'inv-' + this.nextInvite++;
    const pc = new RTCPeerConnection();
    const ch = pc.createDataChannel('game');
    this.attachChannel(key, ch);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    this.pending.set(key, pc);
    return { key, code: encodeBlob(pc.localDescription!.toJSON()) };
  }

  /** l'host applica la risposta del giocatore. Se key manca, usa l'invito più vecchio in attesa. */
  async acceptAnswer(answerBlob: string, key?: string): Promise<void> {
    let k = key;
    if (!k || !this.pending.has(k)) {
      k = this.pending.keys().next().value;
    }
    const pc = k ? this.pending.get(k) : undefined;
    if (!pc) throw new Error('Nessun invito in attesa: genera prima un codice invito');
    await pc.setRemoteDescription(decodeBlob(answerBlob));
    this.pending.delete(k!);
  }

  pendingInvites(): number {
    return this.pending.size;
  }

  private attachChannel(key: string, ch: RTCDataChannel) {
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
    };
    void key;
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

  /**
   * il giocatore incolla/scansiona il codice invito dell'host:
   * applica l'offer e ritorna la risposta (answer) da ridare all'host.
   */
  async acceptInvite(inviteBlob: string): Promise<string> {
    if (!webrtcSupported()) throw new Error(NO_WEBRTC);
    this.pc = new RTCPeerConnection();
    this.pc.ondatachannel = (ev) => {
      this.dc = ev.channel;
      this.dc.onmessage = (e) => {
        try { this.onMessage(JSON.parse(e.data)); } catch { /* ignora */ }
      };
      this.dc.onopen = () => this.onOpen();
    };
    await this.pc.setRemoteDescription(decodeBlob(inviteBlob));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitIce(this.pc);
    return encodeBlob(this.pc.localDescription!.toJSON());
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

// ---------------------------------------------------------------------------
// Discovery: annunciarsi su un server 5emanager raggiungibile (solo relay dei
// codici SDP — il traffico di gioco resta P2P diretto tra i dispositivi).
// ---------------------------------------------------------------------------

export interface P2PHostInfo {
  id: string;
  name: string;
}

export class P2PDiscovery {
  private ws: WebSocket | null = null;
  onHosts: (hosts: P2PHostInfo[]) => void = () => {};
  /** l'host riceve una richiesta di join da `from` (con name/password: in modalità relay il join avviene qui) */
  onJoinRequest: (from: string, name?: string, password?: string) => void = () => {};
  /** il joiner riceve l'invito (offer) dall'host `from` */
  onOffer: (from: string, name: string, code: string) => void = () => {};
  /** l'host riceve la risposta (answer) dal joiner `from` */
  onAnswer: (from: string, code: string) => void = () => {};
  /** relay opaque del traffico di gioco (usato quando WebRTC non è disponibile) */
  onData: (from: string, msg: any) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  connect(url: string): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const to = setTimeout(() => reject(new Error('Timeout connessione a ' + url)), 5000);
      ws.onopen = () => { clearTimeout(to); this.onStatus(true); resolve(); };
      ws.onerror = () => { clearTimeout(to); this.onStatus(false); reject(new Error('Impossibile raggiungere ' + url)); };
      ws.onclose = () => { this.onStatus(false); this.ws = null; };
      ws.onmessage = (ev) => {
        let m: AnyMsg;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'p2pHosts') this.onHosts(m.hosts as P2PHostInfo[]);
        else if (m.t === 'p2pJoinRequest') this.onJoinRequest(String(m.from), m.name, m.password);
        else if (m.t === 'p2pOffer') this.onOffer(String(m.from), String(m.name ?? ''), String(m.code));
        else if (m.t === 'p2pAnswer') this.onAnswer(String(m.from), String(m.code));
        else if (m.t === 'p2pData') {
          try { this.onData(String(m.from), JSON.parse(String(m.data))); } catch { /* ignora */ }
        }
      };
    });
  }

  private send(m: AnyMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  announce(name: string): void { this.send({ t: 'p2pAnnounce', name }); }
  list(): void { this.send({ t: 'p2pList' }); }
  join(hostId: string, name?: string, password?: string): void { this.send({ t: 'p2pJoin', hostId, name, password }); }
  offer(to: string, code: string): void { this.send({ t: 'p2pOffer', to, code }); }
  answer(to: string, code: string): void { this.send({ t: 'p2pAnswer', to, code }); }
  /** relay di un messaggio di gioco verso `to` (trasporto P2P quando WebRTC manca) */
  sendData(to: string, msg: unknown): void { this.send({ t: 'p2pData', to, data: JSON.stringify(msg) }); }

  close(): void {
    try { this.ws?.close(); } catch { /* ignora */ }
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// Trasporto RELAY: quando WebRTC manca (es. AppImage su WebKitGTK), la campagna
// P2P viaggia tutta sul WebSocket del server LAN (che fa solo da relay opaco).
// Stessi messaggi di P2PHost/P2PClient, incapsulati in p2pData.
// ---------------------------------------------------------------------------

export class P2PRelayHost {
  campaign: Campaign;
  reg: Registry;
  masterId: string;
  private disc: P2PDiscovery;
  private cb: HostCallbacks;

  constructor(opts: { campaignName: string; password: string; masterName: string; reg: Registry; disc: P2PDiscovery; cb: HostCallbacks }) {
    this.reg = opts.reg;
    this.disc = opts.disc;
    this.cb = opts.cb;
    const master: PlayerInfo = { id: 'host-' + Math.random().toString(36).slice(2, 8), name: opts.masterName || 'Master', role: 'master' };
    this.campaign = {
      id: Math.random().toString(36).slice(2, 10),
      name: opts.campaignName || 'Campagna P2P',
      passwordHash: opts.password, // in memoria, confrontata in chiaro (campagna effimera)
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
    this.disc.onJoinRequest = (from, name, password) => this.handleJoin(from, name ?? 'Giocatore', password ?? '');
    this.disc.onData = (from, msg) => this.handleData(from, msg);
  }

  private handleJoin(from: string, name: string, password: string): void {
    if (password !== this.campaign.passwordHash) {
      this.sendTo(from, { t: 'error', message: 'Password sbagliata' });
      return;
    }
    if (this.campaign.players.some((p) => p.id !== this.masterId && p.name.toLowerCase() === name.toLowerCase())) {
      this.sendTo(from, { t: 'error', message: 'Nome già in uso in questa campagna' });
      return;
    }
    const player: PlayerInfo = { id: from, name, role: 'player' };
    this.campaign.players.push(player);
    this.sendTo(from, { t: 'welcome', you: player, campaign: this.campaign });
    this.cb.onPeerJoined(player);
    this.broadcastState();
  }

  private handleData(from: string, msg: AnyMsg): void {
    if (msg.t === 'ping') {
      this.sendTo(from, { t: 'pong', id: msg.id, serverTime: Date.now() });
      return;
    }
    if (msg.t === 'action') this.applyAction(from, msg.action as ClientAction);
  }

  applyAction(playerId: string, action: ClientAction): void {
    if (action.kind === 'deleteCampaign') {
      this.broadcast({ t: 'campaignDeleted', id: this.campaign.id });
      return;
    }
    const [next, err] = applyCampaignAction(this.campaign, playerId, this.reg, action);
    if (err) {
      this.sendTo(playerId, { t: 'error', message: err });
      return;
    }
    this.campaign = next;
    this.campaign.updatedAt = new Date().toISOString();
    this.broadcastState();
  }

  sendTo(playerId: string, m: AnyMsg): void {
    this.disc.sendData(playerId, m);
  }

  broadcast(m: AnyMsg): void {
    for (const p of this.campaign.players) if (p.id !== this.masterId) this.sendTo(p.id, m);
  }

  broadcastState(): void {
    this.broadcast({ t: 'state', campaign: this.campaign });
    this.cb.onState(this.campaign);
  }

  peerList(): PlayerInfo[] {
    return this.campaign.players;
  }
}

export class P2PRelayClient {
  onMessage: (m: any) => void = () => {};
  private disc: P2PDiscovery;
  private hostId: string;

  constructor(disc: P2PDiscovery, hostId: string) {
    this.disc = disc;
    this.hostId = hostId;
    this.disc.onData = (_from, msg) => this.onMessage(msg);
  }

  /** entra direttamente: in modalità relay non servono offer/answer SDP */
  join(name: string, password: string): void {
    this.disc.join(this.hostId, name, password);
  }

  send(m: AnyMsg): void {
    this.disc.sendData(this.hostId, m);
  }

  get open(): boolean {
    return this.disc.connected;
  }

  close(): void { /* non chiude la connessione discovery (condivisa) */ }
}
