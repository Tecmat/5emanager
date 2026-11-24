import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Campaign, Character, PlayerInfo, SavedCampaignSnapshot } from '@dnd5e/core';
import { NetClient, defaultWsUrl, isServerWebapp, toWsUrl } from './net.js';
import { checkServerSession } from './serverSession.js';

// i tipi campagna/giocatore vivono nel core (condivisi con server e host P2P)
export type { PlayerInfo };
export type CampaignT = Campaign;

export type ConnState =
  | { phase: 'offline' }
  | { phase: 'connecting'; error?: string }
  | { phase: 'online'; campaign: CampaignT; you: PlayerInfo }
  /** drop di rete: riconnessione automatica in corso (rientro con lo stesso playerId via token) */
  | { phase: 'reconnecting'; campaign: CampaignT; you: PlayerInfo; attempt: number };

export interface AuthState {
  token: string;
  username: string;
  /** server ws da cui arriva il login (default per le campagne) */
  server: string;
  /** ruolo dell'account sul server (admin vede il pulsante per il pannello /admin) */
  role: 'admin' | 'user';
  characters: Character[];
  /** campagne P2P salvate sull'account e sincronizzate col server */
  savedCampaigns: SavedCampaignSnapshot[];
  /** 2FA TOTP attiva sull'account */
  totpEnabled: boolean;
}

export interface TotpSetupMsg {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

/** passkey registrate sull'account (senza chiave pubblica) */
export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  deviceType?: string;
  backedUp?: boolean;
}

/** WebAuthn funziona solo in secure context (https o localhost) */
export const passkeySupported: boolean =
  typeof window !== 'undefined' && window.isSecureContext && typeof PublicKeyCredential !== 'undefined';

export type PingState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; rtt: number }
  | { status: 'error'; message: string };

export interface SavedCampaign {
  server: string;
  id: string;
  name: string;
}

const SERVERS_KEY = 'dnd5e.servers.v1';
const JOINED_KEY = 'dnd5e.joined.v1';
const URL_KEY = 'dnd5e.net.url';
const NAME_KEY = 'dnd5e.net.name';
const REJOIN_KEY = 'dnd5e.rejoinToken.v1';
const SESSION_KEY = 'dnd5e.session.v1';
const AUTH_SERVER_KEY = 'dnd5e.authServer';

export interface SavedSession {
  server: string;
  /** token "mantieni l'accesso" (remember token) */
  token: string;
  username: string;
  at: string;
}

export function loadSavedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (j && j.server && j.token) return j as SavedSession;
    return null;
  } catch { return null; }
}

export function saveSession(s: SavedSession): void {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

export function clearSavedSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/** ultimo server usato per il login: default per le campagne (login + sync schede) */
export function loadAuthServer(): string {
  try { return localStorage.getItem(AUTH_SERVER_KEY) ?? ''; } catch { return ''; }
}

function randomToken(): string {
  return crypto.randomUUID ? crypto.randomUUID() : 'tok-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** token di rientro per campagna (persistente): dopo un drop si rientra con lo stesso playerId */
export function getRejoinToken(campaignId: string): string {
  try {
    const all = JSON.parse(localStorage.getItem(REJOIN_KEY) ?? '{}') as Record<string, string>;
    if (all[campaignId]) return all[campaignId];
    const tok = randomToken();
    all[campaignId] = tok;
    localStorage.setItem(REJOIN_KEY, JSON.stringify(all));
    return tok;
  } catch {
    return randomToken();
  }
}

/** salva il token di rientro sotto il campaignId (usato dopo il welcome di una campagna appena creata) */
export function saveRejoinToken(campaignId: string, token: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(REJOIN_KEY) ?? '{}') as Record<string, string>;
    all[campaignId] = token;
    localStorage.setItem(REJOIN_KEY, JSON.stringify(all));
  } catch { /* quota */ }
}

export function loadServers(): string[] {
  try { return JSON.parse(localStorage.getItem(SERVERS_KEY) ?? '[]') as string[]; } catch { return []; }
}

export function loadJoined(): SavedCampaign[] {
  try { return JSON.parse(localStorage.getItem(JOINED_KEY) ?? '[]') as SavedCampaign[]; } catch { return []; }
}

/** hash SHA-256 usato SOLO lato client per la password dell'account */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('5e-' + s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ConnectOpts {
  mode: 'create' | 'join';
  password: string;
  campaignName: string;
  joinId: string;
  asMaster: boolean;
}

interface NetCtx {
  conn: ConnState;
  auth: AuthState | null;
  error: string;
  setError: (e: string) => void;
  notice: string;
  setNotice: (n: string) => void;
  pingState: PingState;
  campaignList: { id: string; name: string; players: number }[];
  url: string;
  setUrl: (u: string) => void;
  name: string;
  setName: (n: string) => void;
  servers: string[];
  savedCampaigns: SavedCampaign[];
  send: (m: unknown) => void;
  act: (action: unknown) => void;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  handleNetMessage: (m: any) => void;
  setP2PTransport: (fn: ((m: unknown) => void) | null) => void;
  connect: (opts: ConnectOpts) => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
  refreshCampaignList: () => Promise<void>;
  doRegister: (username: string, password: string) => Promise<void>;
  doLogin: (username: string, password: string, remember?: boolean) => Promise<void>;
  /** login automatico con il token "mantieni l'accesso" salvato (primo avvio) */
  doLoginToken: (token: string) => Promise<void>;
  logout: () => void;
  /** sessione "mantieni l'accesso" salvata in locale, se presente */
  savedSession: SavedSession | null;
  /** 2FA: username in attesa di codice TOTP dopo password ok, e dati del setup (QR/secret/backup) */
  totpPending: string | null;
  totpSetup: TotpSetupMsg | null;
  doLoginTotp: (username: string, password: string, code: string, remember?: boolean) => Promise<void>;
  doLoginTotpBackup: (username: string, password: string, backupCode: string, remember?: boolean) => Promise<void>;
  setupTotp: () => Promise<void>;
  enableTotp: (code: string) => Promise<void>;
  disableTotp: (password: string) => Promise<void>;
  /** passkey WebAuthn */
  passkeys: PasskeyInfo[];
  passkeyLogin: (username?: string) => Promise<void>;
  passkeyRegister: () => Promise<void>;
  refreshPasskeys: () => Promise<void>;
  removePasskey: (credentialId: string) => Promise<void>;
}

const Ctx = createContext<NetCtx | null>(null);

export function NetProvider({ children }: { children: ReactNode }) {
  const netRef = useRef<NetClient | null>(null);
  const [conn, setConn] = useState<ConnState>({ phase: 'offline' });
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pingState, setPingState] = useState<PingState>({ status: 'idle' });
  const [campaignList, setCampaignList] = useState<{ id: string; name: string; players: number }[]>([]);
  const [url, setUrlState] = useState(() => {
    const saved = localStorage.getItem(URL_KEY);
    if (saved) return saved;
    // default: l'ultimo server usato per il login (campagne + sync), altrimenti l'origin
    try { const a = localStorage.getItem(AUTH_SERVER_KEY); if (a) return a; } catch { /* ignore */ }
    return defaultWsUrl();
  });
  const [name, setNameState] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [lastUsername, setLastUsername] = useState('');
  const [servers, setServers] = useState<string[]>(loadServers);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaign[]>(loadJoined);
  const [totpPending, setTotpPending] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState<TotpSetupMsg | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() => loadSavedSession());
  /** richieste in attesa di una risposta WS di un certo tipo (es. passkeyLoginOptions) */
  const pendingReq = useRef(new Map<string, { resolve: (m: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const urlRef = useRef(url);
  const nameRef = useRef(name);
  const connRef = useRef(conn);
  connRef.current = conn;
  const lastUsernameRef = useRef(lastUsername);
  lastUsernameRef.current = lastUsername;

  const setUrl = (u: string) => {
    urlRef.current = u;
    setUrlState(u);
    try { localStorage.setItem(URL_KEY, u); } catch { /* quota */ }
  };
  const setName = (n: string) => {
    nameRef.current = n;
    setNameState(n);
    try { localStorage.setItem(NAME_KEY, n); } catch { /* quota */ }
  };

  useEffect(() => () => netRef.current?.close(), []);

  // primo avvio con "mantieni l'accesso": login automatico col token salvato verso l'ultimo server
  useEffect(() => {
    const sess = loadSavedSession();
    if (!sess) return;
    if (!urlRef.current) setUrl(sess.server);
    void (async () => {
      try {
        const net = await ensureNet();
        net.send({ t: 'loginToken', token: sess.token });
      } catch { /* server non raggiungibile: si resta offline */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // webapp servita DAL server: la sessione e' nel cookie HttpOnly (pagina /login del server).
  // /api/me ok -> utente gia' loggato (niente user/password in home/campagna) e apro il WS verso
  // l'origin (il cookie viaggia nell'upgrade: il server risponde con 'auth' completo, libreria inclusa).
  // 401 + requireAuth -> redirect a /login. Offline (PWA dalla cache) -> niente redirect.
  useEffect(() => {
    if (!isServerWebapp()) return;
    void (async () => {
      const s = await checkServerSession();
      if (s.kind === 'login') {
        window.location.replace('/login');
        return;
      }
      if (s.kind === 'server') {
        const server = defaultWsUrl();
        setAuth({ token: '', username: s.me.username, server, role: s.me.role ?? 'user', characters: [], savedCampaigns: [], totpEnabled: !!s.me.totpEnabled });
        setLastUsername(s.me.username);
        try { localStorage.setItem(AUTH_SERVER_KEY, server); } catch { /* quota */ }
        if (!urlRef.current) setUrl(server);
        try {
          await ensureNet();
        } catch { /* server non raggiungibile: resta lo stato preso da /api/me */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rememberServer = (u: string) => {
    setServers((prev) => {
      const next = [u, ...prev.filter((s) => s !== u)].slice(0, 8);
      try { localStorage.setItem(SERVERS_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  };

  const rememberJoined = (c: SavedCampaign) => {
    setSavedCampaigns((prev) => {
      const next = [c, ...prev.filter((x) => !(x.id === c.id && x.server === c.server))].slice(0, 20);
      try { localStorage.setItem(JOINED_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  };

  const p2pRef = useRef<((m: unknown) => void) | null>(null);
  /** watchdog del connect: se il server non manda il welcome, sblocca il pulsante "Entra" */
  const connectWdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** timer del retry di riconnessione automatica */
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** true se la disconnessione \u00e8 volontaria (Esci / kicked / campagna eliminata): niente auto-reconnect */
  const manualCloseRef = useRef(false);
  /** dati dell'ultimo join per il rientro automatico */
  const lastJoinRef = useRef<{ campaignId: string; role: 'master' | 'player' } | null>(null);
  /** token generato per una create in attesa del welcome (poi salvato col campaignId reale) */
  const pendingCreateTokenRef = useRef<string | null>(null);

  const handleMsg = (m: any, serverUrl?: string) => {
    const pend = pendingReq.current.get(m.t);
    if (pend) {
      pendingReq.current.delete(m.t);
      clearTimeout(pend.timer);
      pend.resolve(m);
    }
    if (m.t === 'error') {
      // un errore del server sblocca (e rifiuta) tutte le richieste in attesa
      for (const [, p] of pendingReq.current) {
        clearTimeout(p.timer);
        p.reject(new Error(m.message));
      }
      pendingReq.current.clear();
    }
    if (m.t === 'welcome') {
      if (connectWdRef.current) { clearTimeout(connectWdRef.current); connectWdRef.current = null; }
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      manualCloseRef.current = false;
      lastJoinRef.current = { campaignId: m.campaign.id, role: m.you.role };
      if (pendingCreateTokenRef.current) {
        saveRejoinToken(m.campaign.id, pendingCreateTokenRef.current);
        pendingCreateTokenRef.current = null;
      }
      setConn({ phase: 'online', campaign: m.campaign, you: m.you });
      rememberJoined({ server: serverUrl ?? urlRef.current, id: m.campaign.id, name: m.campaign.name });
    } else if (m.t === 'state') {
      setConn((c) => (c.phase === 'online' ? { ...c, campaign: m.campaign } : c));
    } else if (m.t === 'campaigns') {
      setCampaignList(m.list);
    } else if (m.t === 'auth') {
      const server = serverUrl ?? urlRef.current;
      setAuth({ token: m.token, username: m.username, server, role: m.role ?? 'user', characters: m.characters, savedCampaigns: m.savedCampaigns ?? [], totpEnabled: !!m.totpEnabled });
      setLastUsername(m.username);
      setTotpPending(null);
      // server del login = default per campagne/sync
      try { localStorage.setItem(AUTH_SERVER_KEY, server); } catch { /* quota */ }
      if (!urlRef.current) setUrl(server);
      // "mantieni l'accesso": salva il remember token per il login automatico al prossimo avvio
      if (m.rememberToken) saveSession({ server, token: m.rememberToken, username: m.username, at: new Date().toISOString() });
    } else if (m.t === 'totpRequired') {
      // password ok, serve il codice 2FA
      setTotpPending(m.username);
      setError('');
    } else if (m.t === 'totpSetup') {
      setTotpSetup({ secret: m.secret, otpauthUrl: m.otpauthUrl, backupCodes: m.backupCodes ?? [] });
    } else if (m.t === 'kicked') {
      // espulso dal master (campagna server) o dall'admin: chiudi tutto (niente auto-reconnect)
      manualCloseRef.current = true;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      lastJoinRef.current = null;
      setConn({ phase: 'offline' });
      setError('Sei stato espulso dalla campagna (dal master o dall\'admin).');
      try { netRef.current?.close(); } catch { /* ignora */ }
      netRef.current = null;
    } else if (m.t === 'joinPending' || m.t === 'p2pJoinSent') {
      // la richiesta di join P2P è arrivata all'host: ora si aspetta il master
      setNotice('📨 Richiesta ricevuta dall\'host — in attesa che il master ti accetti…');
    } else if (m.t === 'campaignDeleted') {
      manualCloseRef.current = true;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      lastJoinRef.current = null;
      setConn({ phase: 'offline' });
      setError('La campagna è stata eliminata (dal master o dall\'admin).');
      // tutti giù insieme: chiudi anche il socket verso il server
      try { netRef.current?.close(); } catch { /* ignora */ }
      netRef.current = null;
    } else if (m.t === 'notice') {
      setNotice(m.message);
    } else if (m.t === 'error') {
      setError(m.message);
      // durante la riconnessione automatica: token non pi\u00f9 valido (es. server riavviato) -> niente retry infiniti
      const prev = connRef.current;
      if (prev.phase === 'reconnecting' && /password|non trovata|gi\u00e0 un master/i.test(String(m.message))) {
        manualCloseRef.current = true;
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
        lastJoinRef.current = null;
        setConn({ phase: 'offline' });
      }
    } else if (m.t === 'closed') {
      const prev = connRef.current;
      // drop di rete non volontario: rientro automatico con backoff (stesso playerId via token)
      if (prev.phase === 'online' && !manualCloseRef.current && lastJoinRef.current && !p2pRef.current) {
        scheduleReconnect(prev.campaign, prev.you, 1);
        setConn({ phase: 'reconnecting', campaign: prev.campaign, you: prev.you, attempt: 1 });
      } else {
        setConn({ phase: 'offline' });
      }
    }
  };

  /** retry del join con il token di rientro, backoff esponenziale (max 10s) finch\u00e9 non sei online o non esci */
  const scheduleReconnect = (campaign: CampaignT, you: PlayerInfo, attempt: number) => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      void (async () => {
        const lj = lastJoinRef.current;
        if (!lj || manualCloseRef.current) return;
        try {
          const net = await ensureNet();
          if (lastUsernameRef.current) net.send({ t: 'login', username: lastUsernameRef.current });
          net.send({ t: 'join', campaignId: lj.campaignId, password: '', name: nameRef.current || you.name, role: lj.role, playerToken: getRejoinToken(lj.campaignId) });
        } catch {
          const prev = connRef.current;
          if (prev.phase === 'reconnecting' && !manualCloseRef.current && lastJoinRef.current) {
            scheduleReconnect(prev.campaign, prev.you, attempt + 1);
            setConn({ ...prev, attempt: attempt + 1 });
          }
        }
      })();
    }, delay);
  };

  const attachHandlers = (net: NetClient, serverUrl: string) => {
    net.onMessage((m) => handleMsg(m, serverUrl));
  };

  const ensureNet = async (): Promise<NetClient> => {
    const cur = netRef.current;
    if (cur && cur.ws && cur.ws.readyState === WebSocket.OPEN) return cur;
    cur?.close();
    const net = new NetClient();
    netRef.current = net;
    const target = toWsUrl(urlRef.current) || urlRef.current;
    attachHandlers(net, target);
    await net.connect(target);
    rememberServer(urlRef.current);
    return net;
  };

  const send = (m: unknown) => {
    if (p2pRef.current) p2pRef.current(m);
    else netRef.current?.send(m);
  };
  /** invia un messaggio e aspetta la risposta WS di tipo `expect` (timeout di default 2 min: le cerimonie WebAuthn chiedono il gesto utente) */
  const request = (msg: unknown, expect: string, timeoutMs = 120000): Promise<any> =>
    new Promise((resolve, reject) => {
      ensureNet()
        .then((net) => {
          const timer = setTimeout(() => {
            pendingReq.current.delete(expect);
            reject(new Error('Timeout in attesa della risposta del server (' + expect + ')'));
          }, timeoutMs);
          pendingReq.current.set(expect, {
            resolve: (m) => resolve(m),
            reject,
            timer,
          });
          net.send(msg);
        })
        .catch(reject);
    });
  const act = (action: unknown) => send({ t: 'action', action });
  const setP2PTransport = (fn: ((m: unknown) => void) | null) => {
    p2pRef.current = fn;
  };

  const checkConnection = async () => {
    setPingState({ status: 'checking' });
    if (p2pRef.current) {
      // in modalità P2P l'host è locale: ping "locale"
      setPingState({ status: 'ok', rtt: 0 });
      return;
    }
    try {
      const net = await ensureNet();
      const res = await net.ping();
      setPingState({ status: 'ok', rtt: Math.round(res.rtt) });
    } catch (e) {
      setPingState({ status: 'error', message: (e as Error).message });
    }
  };

  const refreshCampaignList = async () => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'list' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doRegister = async (username: string, password: string) => {
    setError('');
    setNotice('');
    if (!username.trim()) { setError('Inserisci uno username'); return; }
    try {
      const net = await ensureNet();
      // la password va al server (verificata lì con hash sha256)
      net.send({ t: 'register', username: username.trim(), password });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doLogin = async (username: string, password: string, remember = false) => {
    setError('');
    setNotice('');
    if (!username.trim()) { setError('Inserisci lo username'); return; }
    try {
      const net = await ensureNet();
      net.send({ t: 'login', username: username.trim(), password, remember });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doLoginToken = async (token: string) => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'loginToken', token });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const logout = () => {
    clearSavedSession();
    setSavedSession(null);
    setAuth(null);
    setLastUsername('');
    setTotpPending(null);
    setTotpSetup(null);
    setPasskeys([]);
    // su webapp servita dal server la sessione e' anche nel cookie: la revoco via /api/logout,
    // poi se il server impone il login torno alla pagina /login
    if (isServerWebapp()) {
      void (async () => {
        try {
          await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
        } catch { /* offline: resta solo lo stato locale */ }
        const s = await checkServerSession();
        if (s.kind === 'login') window.location.replace('/login');
      })();
    }
  };

  // --- 2FA TOTP ---
  const doLoginTotp = async (username: string, password: string, code: string, remember = false) => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'loginTotp', username: username.trim(), password, code: code.trim(), remember });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doLoginTotpBackup = async (username: string, password: string, backupCode: string, remember = false) => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'loginTotpBackup', username: username.trim(), password, backupCode: backupCode.trim(), remember });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const setupTotp = async () => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'setupTotp' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const enableTotp = async (code: string) => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'enableTotp', code: code.trim() });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const disableTotp = async (password: string) => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'disableTotp', password });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // --- passkey WebAuthn ---

  const refreshPasskeys = async () => {
    if (!passkeySupported) return;
    try {
      const res = await request({ t: 'passkeyList' }, 'passkeyList', 15000);
      setPasskeys(res.passkeys ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const passkeyRegister = async () => {
    setError('');
    setNotice('');
    if (!passkeySupported) {
      setError('Le passkey richiedono un contesto sicuro (HTTPS o localhost)');
      return;
    }
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const opts = await request({ t: 'passkeyRegisterStart' }, 'passkeyRegisterOptions');
      const attResp = await startRegistration({ optionsJSON: opts.options });
      const res = await request({ t: 'passkeyRegisterFinish', response: attResp }, 'passkeyList');
      setPasskeys(res.passkeys ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const passkeyLogin = async (username?: string) => {
    setError('');
    setNotice('');
    if (!passkeySupported) {
      setError('Le passkey richiedono un contesto sicuro (HTTPS o localhost): configura https sul server');
      return;
    }
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const uname = username?.trim() || undefined;
      const opts = await request({ t: 'passkeyLoginStart', username: uname }, 'passkeyLoginOptions');
      const asseResp = await startAuthentication({ optionsJSON: opts.options });
      await request({ t: 'passkeyLoginFinish', username: uname, response: asseResp }, 'auth');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removePasskey = async (credentialId: string) => {
    setError('');
    try {
      const res = await request({ t: 'passkeyRemove', credentialId }, 'passkeyList', 15000);
      setPasskeys(res.passkeys ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const connect = async (opts: ConnectOpts) => {
    setError('');
    manualCloseRef.current = false;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    setConn({ phase: 'connecting' });
    try {
      const net = await ensureNet();
      if (lastUsernameRef.current) net.send({ t: 'login', username: lastUsernameRef.current });
      if (opts.mode === 'create') {
        pendingCreateTokenRef.current = randomToken();
        net.send({ t: 'create', name: nameRef.current || 'Giocatore', password: opts.password, campaignName: opts.campaignName || 'Nuova campagna', playerToken: pendingCreateTokenRef.current });
      } else {
        net.send({ t: 'join', campaignId: opts.joinId, password: opts.password, name: nameRef.current || 'Giocatore', role: opts.asMaster ? 'master' : 'player', playerToken: getRejoinToken(opts.joinId) });
      }
      // watchdog: WS aperto ma nessun welcome entro 10s -> non restare bloccati su "Connessione..."
      if (connectWdRef.current) clearTimeout(connectWdRef.current);
      connectWdRef.current = setTimeout(() => {
        connectWdRef.current = null;
        setConn((c) => (c.phase === 'connecting' ? { phase: 'offline' } : c));
        setError('Nessuna risposta dal server entro 10s (timeout): controlla ws:// URL e porta');
      }, 10_000);
    } catch (e) {
      if (connectWdRef.current) { clearTimeout(connectWdRef.current); connectWdRef.current = null; }
      setError((e as Error).message);
      setConn({ phase: 'offline' });
    }
  };

  const disconnect = () => {
    manualCloseRef.current = true;
    if (connectWdRef.current) { clearTimeout(connectWdRef.current); connectWdRef.current = null; }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    lastJoinRef.current = null;
    netRef.current?.close();
    setConn({ phase: 'offline' });
  };

  const value: NetCtx = {
    conn, auth, error, setError, notice, setNotice, pingState, campaignList,
    url, setUrl, name, setName, servers, savedCampaigns,
    send, act, setConn, handleNetMessage: (m: any) => handleMsg(m), setP2PTransport,
    connect, disconnect, checkConnection, refreshCampaignList,
    doRegister, doLogin, doLoginToken, logout, savedSession,
    totpPending, totpSetup, doLoginTotp, doLoginTotpBackup, setupTotp, enableTotp, disableTotp,
    passkeys, passkeyLogin, passkeyRegister, refreshPasskeys, removePasskey,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNet(): NetCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNet fuori dal provider');
  return ctx;
}
