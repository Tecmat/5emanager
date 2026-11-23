import {
  applyCampaignAction,
  DEFAULT_HOUSE_RULES,
  resumeCampaign,
  setPlayerOnline,
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

/** prefisso del QR/deep link per il codice invito BREVE (relayato dal server: niente SDP da incollare) */
export const CODE_PREFIX = '5ECODE:';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente 0/O, 1/I/L per evitare confusione

/** genera un codice invito breve formattato XXXX-XXXX */
export function newInviteCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return raw.slice(0, 4) + '-' + raw.slice(4);
}

/** WebRTC disponibile? Su WebKitGTK (AppImage Linux) spesso RTCPeerConnection manca: il P2P diretto non funziona lì */
export function webrtcSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

const NO_WEBRTC = 'WebRTC non supportato in questo ambiente (RTCPeerConnection mancante — es. AppImage su WebKitGTK): usa la modalità 🌐 server remoto';

/**
 * costruisce la campagna dell'host: nuova da zero, oppure RIPRESA da uno snapshot
 * salvato in locale (existing) — vedi resumeCampaign nel core (nuovo id, solo master,
 * niente schede/combattimento vecchi; la password viene reinserita e non è salvata).
 */
function buildCampaign(opts: { campaignName: string; password: string; masterName: string; existing?: Campaign }): { campaign: Campaign; master: PlayerInfo } {
  const master: PlayerInfo = { id: 'host-' + Math.random().toString(36).slice(2, 8), name: opts.masterName || 'Master', role: 'master' };
  if (opts.existing) {
    const c = resumeCampaign(opts.existing, opts.password, master);
    if (opts.campaignName.trim()) c.name = opts.campaignName.trim();
    return { campaign: c, master };
  }
  return {
    master,
    campaign: {
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
      chat: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}


/** grace period (ms) prima di rimuovere un peer P2P disconnesso: nel frattempo resta "disconnesso" e può rientrare col token */
export const P2P_REJOIN_GRACE_MS = 60_000;

const P2P_TOKEN_KEY = 'dnd5e.p2pRejoinToken.v1';

/** token di rientro del client P2P per un host (persistente): dopo un drop rientra con lo stesso playerId */
export function getP2PRejoinToken(hostKey: string): string {
  try {
    const all = JSON.parse(localStorage.getItem(P2P_TOKEN_KEY) ?? '{}') as Record<string, string>;
    if (all[hostKey]) return all[hostKey];
    const tok = crypto.randomUUID ? crypto.randomUUID() : 'tok-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    all[hostKey] = tok;
    localStorage.setItem(P2P_TOKEN_KEY, JSON.stringify(all));
    return tok;
  } catch {
    return 'tok-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

/** marca un peer offline e programma la rimozione dopo il grace period (se non rientra) */
function makeOfflineScheduler(markOffline: (playerId: string) => void, removePeer: (playerId: string) => void) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    onPeerGone(playerId: string): void {
      markOffline(playerId);
      const prev = timers.get(playerId);
      if (prev) clearTimeout(prev);
      timers.set(playerId, setTimeout(() => {
        timers.delete(playerId);
        removePeer(playerId);
      }, P2P_REJOIN_GRACE_MS));
    },
    onPeerBack(playerId: string): void {
      const prev = timers.get(playerId);
      if (prev) { clearTimeout(prev); timers.delete(playerId); }
    },
  };
}

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
  /** relay: una richiesta di join è in attesa di essere accettata dal master */
  onJoinPending?: (req: { from: string; name: string }) => void;
  /** la campagna è stata eliminata: disconnetti tutti i peer e l'host stesso */
  onCampaignDeleted?: (id: string) => void;
}

type AnyMsg = Record<string, any>;

export class P2PHost {
  campaign: Campaign;
  reg: Registry;
  private peers = new Map<string, RTCDataChannel>(); // playerId -> channel
  private pending = new Map<string, RTCPeerConnection>(); // inviteKey -> pc in attesa di answer
  private pcs = new Set<RTCPeerConnection>(); // tutte le pc (per chiudere tutto su deleteCampaign)
  private cb: HostCallbacks;
  private nextInvite = 0;
  private rejoinTokens = new Map<string, string>(); // playerId -> token
  private offline = makeOfflineScheduler(
    (pid) => { setPlayerOnline(this.campaign, pid, false); this.broadcastState(); },
    (pid) => {
      this.campaign.players = this.campaign.players.filter((p) => p.id !== pid);
      this.rejoinTokens.delete(pid);
      this.cb.onPeerLeft(pid);
      this.broadcastState();
    },
  );

  constructor(opts: { campaignName: string; password: string; masterName: string; reg: Registry; cb: HostCallbacks; existing?: Campaign }) {
    this.reg = opts.reg;
    this.cb = opts.cb;
    const { campaign, master } = buildCampaign(opts);
    this.campaign = campaign;
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
    this.pcs.add(pc);
    const ch = pc.createDataChannel('game');
    this.attachChannel(key, ch, pc);
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

  private attachChannel(key: string, ch: RTCDataChannel, pc?: RTCPeerConnection) {
    ch.onmessage = (ev) => {
      let msg: AnyMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const playerId = [...this.peers.entries()].find(([, c]) => c === ch)?.[0];
      this.handlePeerMessage(ch, playerId, msg);
    };
    ch.onclose = () => {
      if (pc) this.pcs.delete(pc);
      const playerId = [...this.peers.entries()].find(([, c]) => c === ch)?.[0];
      if (playerId) {
        this.peers.delete(playerId);
        // grace period: resta "disconnesso" e può rientrare col token entro P2P_REJOIN_GRACE_MS
        this.offline.onPeerGone(playerId);
      }
    };
    void key;
  }

  private handlePeerMessage(ch: RTCDataChannel, playerId: string | undefined, msg: AnyMsg) {
    if (msg.t === 'join') {
      // rientro automatico dopo un drop: token valido -> stesso playerId, niente password
      if (msg.playerToken) {
        const [pid, tok] = [...this.rejoinTokens.entries()].find(([, t]) => t === msg.playerToken) ?? [];
        const existing = pid ? this.campaign.players.find((p) => p.id === pid) : undefined;
        if (existing) {
          this.offline.onPeerBack(existing.id);
          setPlayerOnline(this.campaign, existing.id, true);
          if (msg.name) existing.name = String(msg.name);
          this.peers.set(existing.id, ch);
          ch.send(JSON.stringify({ t: 'welcome', you: existing, campaign: this.campaign }));
          this.cb.onPeerJoined(existing);
          this.broadcastState();
          return;
        }
      }
      // password facoltativa: se l'host non l'ha impostata (passwordHash vuoto) non si controlla
      if (this.campaign.passwordHash && msg.password !== this.campaign.passwordHash) {
        ch.send(JSON.stringify({ t: 'error', message: 'Password sbagliata' }));
        return;
      }
      if (this.campaign.players.some((p) => p.name.toLowerCase() === String(msg.name).toLowerCase())) {
        ch.send(JSON.stringify({ t: 'error', message: 'Nome già in uso in questa campagna' }));
        return;
      }
      const player: PlayerInfo = { id: 'p2p-' + Math.random().toString(36).slice(2, 8), name: String(msg.name || 'Giocatore'), role: 'player', online: true };
      this.campaign.players.push(player);
      if (msg.playerToken) this.rejoinTokens.set(player.id, String(msg.playerToken));
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
      // tutti giù insieme: chiudi canali e peer connection, poi avvisa l'UI dell'host
      for (const ch of this.peers.values()) { try { ch.close(); } catch { /* ignora */ } }
      for (const pc of this.pcs) { try { pc.close(); } catch { /* ignora */ } }
      this.peers.clear();
      this.pcs.clear();
      this.cb.onCampaignDeleted?.(this.campaign.id);
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
    if (action.kind === 'kickPlayer') {
      // avvisa e chiudi il canale del giocatore espulso
      const ch = this.peers.get(action.playerId);
      if (ch) {
        try { ch.send(JSON.stringify({ t: 'kicked' })); } catch { /* ignora */ }
        this.peers.delete(action.playerId);
        try { ch.close(); } catch { /* ignora */ }
      }
    }
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

  /** entra nella campagna (dopo onOpen); hostKey serve per il token di rientro persistente */
  join(name: string, password: string, hostKey = 'rtc'): void {
    this.send({ t: 'join', name, password, playerToken: getP2PRejoinToken(hostKey) });
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
  /** IP LAN dell'host (dal socket del server), utile per mostrarlo nella lista */
  ip?: string;
}

export class P2PDiscovery {
  private ws: WebSocket | null = null;
  onHosts: (hosts: P2PHostInfo[]) => void = () => {};
  /** l'host riceve una richiesta di join da `from` (con name/password: in modalità relay il join avviene qui) */
  onJoinRequest: (from: string, name?: string, password?: string, playerToken?: string) => void = () => {};
  /** relay: un peer il cui socket verso il server si è chiuso (connId) */
  onPeerGone?: (from: string) => void;
  /** il joiner riceve l'invito (offer) dall'host `from` */
  onOffer: (from: string, name: string, code: string) => void = () => {};
  /** l'host riceve la risposta (answer) dal joiner `from` */
  onAnswer: (from: string, code: string) => void = () => {};
  /** il joiner ha risolto un codice invito breve in hostId (per il trasporto relay) */
  onCodeHost?: (hostId: string, name: string) => void;
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
        else if (m.t === 'p2pCodeHost') this.onCodeHost?.(String(m.hostId), String(m.name ?? ''));
        else if (m.t === 'p2pJoinRequest') this.onJoinRequest(String(m.from), m.name, m.password, m.playerToken);
        else if (m.t === 'p2pPeerGone') this.onPeerGone?.(String(m.from));
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
  /** annuncia un codice invito breve (l'host appare anche nella lista host) */
  announceCode(code: string, name?: string): void { this.send({ t: 'p2pAnnounceCode', code, name }); }
  list(): void { this.send({ t: 'p2pList' }); }
  join(hostId: string, name?: string, password?: string, playerToken?: string): void { this.send({ t: 'p2pJoin', hostId, name, password, playerToken }); }
  /** unisciti a un host tramite codice invito breve (il server risolve il codice in hostId e relay la richiesta) */
  joinByCode(code: string, name?: string, password?: string, playerToken?: string): void { this.send({ t: 'p2pJoinCode', code, name, password, playerToken }); }
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
  /** se true, il master deve accettare ogni richiesta (pulsanti ✅/✖), default true */
  requireAccept: boolean;
  private pending = new Map<string, string>(); // connId -> name
  private rejoinTokens = new Map<string, string>(); // playerId -> token
  private offline = makeOfflineScheduler(
    (pid) => { setPlayerOnline(this.campaign, pid, false); this.broadcastState(); },
    (pid) => {
      this.campaign.players = this.campaign.players.filter((p) => p.id !== pid);
      this.rejoinTokens.delete(pid);
      this.cb.onPeerLeft(pid);
      this.broadcastState();
    },
  );

  constructor(opts: { campaignName: string; password: string; masterName: string; reg: Registry; disc: P2PDiscovery; cb: HostCallbacks; requireAccept?: boolean; existing?: Campaign }) {
    this.reg = opts.reg;
    this.disc = opts.disc;
    this.cb = opts.cb;
    this.requireAccept = opts.requireAccept ?? true;
    const { campaign, master } = buildCampaign(opts);
    this.campaign = campaign;
    this.masterId = master.id;
    this.disc.onJoinRequest = (from, name, password, playerToken) => {
      if (this.requireAccept && !this.campaign.players.some((p) => p.id === from)) {
        this.pending.set(from, name ?? 'Giocatore');
        this.pendingPw.set(from, password ?? '');
        if (playerToken) this.pendingTokens.set(from, playerToken);
        this.cb.onJoinPending?.({ from, name: name ?? 'Giocatore' });
        // ack: la richiesta è arrivata, ora si aspetta il master
        this.sendTo(from, { t: 'joinPending' });
        return;
      }
      this.handleJoin(from, name ?? 'Giocatore', password ?? '', playerToken);
    };
    this.disc.onData = (from, msg) => this.handleData(from, msg);
    this.disc.onPeerGone = (from) => {
      // il socket del giocatore verso il server si è chiuso: grace period prima di rimuoverlo
      if (this.campaign.players.some((p) => p.id === from && p.id !== this.masterId)) this.offline.onPeerGone(from);
    };
  }

  /** il master accetta la richiesta in attesa: il giocatore entra e riceve il welcome */
  acceptJoin(from: string): void {
    const name = this.pending.get(from) ?? 'Giocatore';
    const token = this.pendingTokens.get(from);
    this.pending.delete(from);
    this.pendingTokens.delete(from);
    this.handleJoin(from, name, this._lastPassword(from), token);
  }

  /** il master rifiuta la richiesta */
  rejectJoin(from: string): void {
    this.pending.delete(from);
    this.sendTo(from, { t: 'error', message: 'Richiesta rifiutata dal master' });
  }

  /** password delle join in attesa (serve per acceptJoin dopo il click) */
  private pendingPw = new Map<string, string>();
  private pendingTokens = new Map<string, string>();
  private _lastPassword(from: string): string {
    return this.pendingPw.get(from) ?? this.campaign.passwordHash;
  }

  private handleJoin(from: string, name: string, password: string, playerToken?: string): void {
    this.pendingPw.set(from, password);
    // rientro automatico dopo un drop: token valido -> stesso playerId, niente password
    if (playerToken) {
      const [pid] = [...this.rejoinTokens.entries()].find(([, t]) => t === playerToken) ?? [];
      const existing = pid ? this.campaign.players.find((p) => p.id === pid) : undefined;
      if (existing) {
        this.offline.onPeerBack(existing.id);
        setPlayerOnline(this.campaign, existing.id, true);
        if (name) existing.name = name;
        this.sendTo(existing.id, { t: 'welcome', you: existing, campaign: this.campaign });
        this.cb.onPeerJoined(existing);
        this.broadcastState();
        return;
      }
    }
    if (this.campaign.passwordHash && password !== this.campaign.passwordHash) {
      this.sendTo(from, { t: 'error', message: 'Password sbagliata' });
      return;
    }
    if (this.campaign.players.some((p) => p.id !== this.masterId && p.name.toLowerCase() === name.toLowerCase())) {
      this.sendTo(from, { t: 'error', message: 'Nome già in uso in questa campagna' });
      return;
    }
    const player: PlayerInfo = { id: from, name, role: 'player', online: true };
    this.campaign.players.push(player);
    if (playerToken) this.rejoinTokens.set(player.id, playerToken);
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
      // i peer ricevono campaignDeleted e chiudono da soli il loro socket; avvisa anche l'UI dell'host
      this.broadcast({ t: 'campaignDeleted', id: this.campaign.id });
      this.cb.onCampaignDeleted?.(this.campaign.id);
      return;
    }
    const [next, err] = applyCampaignAction(this.campaign, playerId, this.reg, action);
    if (err) {
      this.sendTo(playerId, { t: 'error', message: err });
      return;
    }
    this.campaign = next;
    this.campaign.updatedAt = new Date().toISOString();
    if (action.kind === 'kickPlayer') this.sendTo(action.playerId, { t: 'kicked' });
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
  join(name: string, password: string, playerToken?: string): void {
    this.disc.join(this.hostId, name, password, playerToken);
  }

  send(m: AnyMsg): void {
    this.disc.sendData(this.hostId, m);
  }

  get open(): boolean {
    return this.disc.connected;
  }

  close(): void { /* non chiude la connessione discovery (condivisa) */ }
}

// ---------------------------------------------------------------------------
// Trasporto LAN "stile Soul Knight": il dispositivo HOST apre un beacon nativo
// (Tauri/AppImage/Windows/macOS via comando Rust, APK via plugin LanBeacon) che
// serve /api/info (scoperta) e accetta WebSocket su /ws. I giocatori, trovando
// l'host con la scansione LAN, aprono un WebSocket DIRETTO ws://ip:porta/ws e si
// uniscono con un tap — niente server, niente codici, niente WebRTC.
// Stessi messaggi di gioco di P2PHost/P2PRelayHost (join/welcome/state/action…).
// ---------------------------------------------------------------------------

import { beaconBroadcast, beaconSend, beaconStop, onLanEvt } from './lanBeacon.js';

function makeP2PCampaign(opts: { campaignName: string; password: string; masterName: string; existing?: Campaign }): Campaign {
  return buildCampaign(opts).campaign;
}

/** HOST lato dispositivo: la campagna vive qui, i giocatori arrivano dal beacon LAN via WS diretto */
export class P2PLanHost {
  campaign: Campaign;
  reg: Registry;
  masterId: string;
  requireAccept: boolean;
  private cb: HostCallbacks;
  private pending = new Map<string, { name: string; password: string; relay: boolean; playerToken?: string }>();
  private offEvt: (() => void) | null = null;
  /** connessioni del server (relay): peer che arrivano via codice breve/lista host, non dal beacon */
  private disc: P2PDiscovery | null = null;
  private relayPeers = new Set<string>();
  private rejoinTokens = new Map<string, string>(); // playerId -> token
  private offline = makeOfflineScheduler(
    (pid) => { setPlayerOnline(this.campaign, pid, false); this.broadcastState(); },
    (pid) => {
      this.campaign.players = this.campaign.players.filter((p) => p.id !== pid);
      this.rejoinTokens.delete(pid);
      this.relayPeers.delete(pid);
      this.cb.onPeerLeft(pid);
      this.broadcastState();
    },
  );

  constructor(opts: { campaignName: string; password: string; masterName: string; reg: Registry; cb: HostCallbacks; requireAccept?: boolean; existing?: Campaign }) {
    this.reg = opts.reg;
    this.cb = opts.cb;
    this.requireAccept = opts.requireAccept ?? true;
    this.campaign = makeP2PCampaign(opts);
    this.masterId = this.campaign.players[0].id;
    this.offEvt = onLanEvt((ev) => {
      const [kind, id, payload] = ev;
      if (kind === 'msg' && payload) {
        let msg: AnyMsg;
        try { msg = JSON.parse(payload); } catch { return; }
        this.handleData(id, msg);
      } else if (kind === 'close') {
        const p = this.campaign.players.find((x) => x.id === id);
        if (p && p.id !== this.masterId) {
          // grace period: resta "disconnesso" e può rientrare col token entro P2P_REJOIN_GRACE_MS
          this.offline.onPeerGone(id);
        }
      }
    });
  }

  /**
   * annunciati su un server 5emanager: i giocatori che arrivano dal server (codice breve
   * XXXX-XXXX o lista host) entrano sulla STESSA campagna via relay p2pData, oltre a quelli
   * del beacon LAN (stesso handleData: stessi messaggi join/welcome/state/action).
   */
  attachDiscovery(disc: P2PDiscovery): void {
    this.disc = disc;
    disc.onJoinRequest = (from, name, password, playerToken) => {
      if (this.requireAccept && !this.campaign.players.some((p) => p.id === from)) {
        this.pending.set(from, { name: name ?? 'Giocatore', password: password ?? '', relay: true, playerToken });
        this.cb.onJoinPending?.({ from, name: name ?? 'Giocatore' });
        this.sendTo(from, { t: 'joinPending' });
        return;
      }
      this.doJoin(from, name ?? 'Giocatore', password ?? '', true, playerToken);
    };
    disc.onData = (from, msg) => {
      if (this.relayPeers.has(from)) this.handleData(from, msg);
    };
    disc.onPeerGone = (from) => {
      if (this.campaign.players.some((p) => p.id === from && p.id !== this.masterId)) this.offline.onPeerGone(from);
    };
  }

  private handleData(from: string, msg: AnyMsg): void {
    if (msg.t === 'join') {
      const name = String(msg.name || 'Giocatore');
      const password = String(msg.password ?? '');
      const playerToken = msg.playerToken ? String(msg.playerToken) : undefined;
      if (this.requireAccept && !this.campaign.players.some((p) => p.id === from)) {
        this.pending.set(from, { name, password, relay: false, playerToken });
        this.cb.onJoinPending?.({ from, name });
        this.sendTo(from, { t: 'joinPending' });
        return;
      }
      this.doJoin(from, name, password, false, playerToken);
      return;
    }
    if (msg.t === 'ping') {
      this.sendTo(from, { t: 'pong', id: msg.id, serverTime: Date.now() });
      return;
    }
    if (msg.t === 'action') this.applyAction(from, msg.action as ClientAction);
  }

  private doJoin(from: string, name: string, password: string, relay: boolean, playerToken?: string): void {
    // rientro automatico dopo un drop: token valido -> stesso playerId, niente password
    if (playerToken) {
      const [pid] = [...this.rejoinTokens.entries()].find(([, t]) => t === playerToken) ?? [];
      const existing = pid ? this.campaign.players.find((p) => p.id === pid) : undefined;
      if (existing) {
        this.offline.onPeerBack(existing.id);
        setPlayerOnline(this.campaign, existing.id, true);
        if (name) existing.name = name;
        if (relay) this.relayPeers.add(existing.id);
        this.sendTo(existing.id, { t: 'welcome', you: existing, campaign: this.campaign });
        this.cb.onPeerJoined(existing);
        this.broadcastState();
        return;
      }
    }
    if (this.campaign.passwordHash && password !== this.campaign.passwordHash) {
      this.sendTo(from, { t: 'error', message: 'Password sbagliata' });
      return;
    }
    if (this.campaign.players.some((p) => p.id !== this.masterId && p.name.toLowerCase() === name.toLowerCase())) {
      this.sendTo(from, { t: 'error', message: 'Nome già in uso in questa campagna' });
      return;
    }
    const player: PlayerInfo = { id: from, name, role: 'player', online: true };
    this.campaign.players.push(player);
    if (playerToken) this.rejoinTokens.set(player.id, playerToken);
    if (relay) this.relayPeers.add(from);
    this.sendTo(from, { t: 'welcome', you: player, campaign: this.campaign });
    this.cb.onPeerJoined(player);
    this.broadcastState();
  }

  /** il master accetta la richiesta in attesa */
  acceptJoin(from: string): void {
    const p = this.pending.get(from);
    this.pending.delete(from);
    this.doJoin(from, p?.name ?? 'Giocatore', p?.password ?? '', p?.relay ?? false, p?.playerToken);
  }

  /** il master rifiuta la richiesta */
  rejectJoin(from: string): void {
    this.pending.delete(from);
    this.sendTo(from, { t: 'error', message: 'Richiesta rifiutata dal master' });
  }

  applyAction(playerId: string, action: ClientAction): void {
    if (action.kind === 'deleteCampaign') {
      this.broadcast({ t: 'campaignDeleted', id: this.campaign.id });
      // dai tempo al messaggio di arrivare ai giocatori, poi chiudi il beacon (tutti i loro socket)
      setTimeout(() => { void beaconStop(); }, 400);
      this.cb.onCampaignDeleted?.(this.campaign.id);
      return;
    }
    const [next, err] = applyCampaignAction(this.campaign, playerId, this.reg, action);
    if (err) {
      this.sendTo(playerId, { t: 'error', message: err });
      return;
    }
    this.campaign = next;
    this.campaign.updatedAt = new Date().toISOString();
    if (action.kind === 'kickPlayer') this.sendTo(action.playerId, { t: 'kicked' });
    this.broadcastState();
  }

  sendTo(playerId: string, m: AnyMsg): void {
    // i peer del server (relay) ricevono via p2pData, quelli del beacon via WS diretto
    if (this.relayPeers.has(playerId)) {
      this.disc?.sendData(playerId, m);
      return;
    }
    void beaconSend(playerId, JSON.stringify(m));
  }

  broadcast(m: AnyMsg): void {
    void beaconBroadcast(JSON.stringify(m));
    for (const id of this.relayPeers) this.disc?.sendData(id, m);
  }

  broadcastState(): void {
    this.broadcast({ t: 'state', campaign: this.campaign });
    this.cb.onState(this.campaign);
  }

  peerList(): PlayerInfo[] {
    return this.campaign.players;
  }

  close(): void {
    this.offEvt?.();
    this.offEvt = null;
    void beaconStop();
  }
}

/** CLIENT lato giocatore: WebSocket diretto verso il beacon dell'host (ws://ip:porta/ws) */
export class P2PLanClient {
  onMessage: (m: any) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket | null = null;

  constructor(private ip: string, private port: number) {}

  connect(): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.ip}:${this.port}/ws`);
      this.ws = ws;
      const to = setTimeout(() => reject(new Error(`Timeout connessione a ws://${this.ip}:${this.port}/ws`)), 5000);
      ws.onopen = () => { clearTimeout(to); this.onOpen(); resolve(); };
      ws.onerror = () => { clearTimeout(to); reject(new Error(`Impossibile raggiungere l'host ${this.ip}:${this.port} — siete sulla stessa rete?`)); };
      ws.onclose = () => { this.onClose(); this.ws = null; };
      ws.onmessage = (ev) => {
        try { this.onMessage(JSON.parse(String(ev.data))); } catch { /* ignora */ }
      };
    });
  }

  /** entra nella campagna (dopo onOpen); hostKey serve per il token di rientro persistente */
  join(name: string, password: string, hostKey?: string): void {
    this.send({ t: 'join', name, password, playerToken: hostKey ? getP2PRejoinToken(hostKey) : undefined });
  }

  send(m: AnyMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  get open(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    try { this.ws?.close(); } catch { /* ignora */ }
    this.ws = null;
  }
}
