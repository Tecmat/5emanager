import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Campaign, Character, PlayerInfo, SavedCampaignSnapshot } from '@dnd5e/core';
import { NetClient, defaultWsUrl } from './net.js';

// i tipi campagna/giocatore vivono nel core (condivisi con server e host P2P)
export type { PlayerInfo };
export type CampaignT = Campaign;

export type ConnState =
  | { phase: 'offline' }
  | { phase: 'connecting'; error?: string }
  | { phase: 'online'; campaign: CampaignT; you: PlayerInfo };

export interface AuthState {
  token: string;
  username: string;
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
  doLogin: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** 2FA: username in attesa di codice TOTP dopo password ok, e dati del setup (QR/secret/backup) */
  totpPending: string | null;
  totpSetup: TotpSetupMsg | null;
  doLoginTotp: (username: string, password: string, code: string) => Promise<void>;
  doLoginTotpBackup: (username: string, password: string, backupCode: string) => Promise<void>;
  setupTotp: () => Promise<void>;
  enableTotp: (code: string) => Promise<void>;
  disableTotp: (password: string) => Promise<void>;
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
  const [url, setUrlState] = useState(() => localStorage.getItem(URL_KEY) ?? defaultWsUrl());
  const [name, setNameState] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [lastUsername, setLastUsername] = useState('');
  const [servers, setServers] = useState<string[]>(loadServers);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaign[]>(loadJoined);
  const [totpPending, setTotpPending] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState<TotpSetupMsg | null>(null);
  const urlRef = useRef(url);
  const nameRef = useRef(name);
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

  const handleMsg = (m: any, serverUrl?: string) => {
    if (m.t === 'welcome') {
      if (connectWdRef.current) { clearTimeout(connectWdRef.current); connectWdRef.current = null; }
      setConn({ phase: 'online', campaign: m.campaign, you: m.you });
      rememberJoined({ server: serverUrl ?? urlRef.current, id: m.campaign.id, name: m.campaign.name });
    } else if (m.t === 'state') {
      setConn((c) => (c.phase === 'online' ? { ...c, campaign: m.campaign } : c));
    } else if (m.t === 'campaigns') {
      setCampaignList(m.list);
    } else if (m.t === 'auth') {
      setAuth({ token: m.token, username: m.username, characters: m.characters, savedCampaigns: m.savedCampaigns ?? [], totpEnabled: !!m.totpEnabled });
      setLastUsername(m.username);
      setTotpPending(null);
    } else if (m.t === 'totpRequired') {
      // password ok, serve il codice 2FA
      setTotpPending(m.username);
      setError('');
    } else if (m.t === 'totpSetup') {
      setTotpSetup({ secret: m.secret, otpauthUrl: m.otpauthUrl, backupCodes: m.backupCodes ?? [] });
    } else if (m.t === 'kicked') {
      // espulso dal master (campagna server) o dall'admin: chiudi tutto
      setConn({ phase: 'offline' });
      setError('Sei stato espulso dalla campagna (dal master o dall\'admin).');
      try { netRef.current?.close(); } catch { /* ignora */ }
      netRef.current = null;
    } else if (m.t === 'joinPending' || m.t === 'p2pJoinSent') {
      // la richiesta di join P2P è arrivata all'host: ora si aspetta il master
      setNotice('📨 Richiesta ricevuta dall\'host — in attesa che il master ti accetti…');
    } else if (m.t === 'campaignDeleted') {
      setConn({ phase: 'offline' });
      setError('La campagna è stata eliminata (dal master o dall\'admin).');
      // tutti giù insieme: chiudi anche il socket verso il server
      try { netRef.current?.close(); } catch { /* ignora */ }
      netRef.current = null;
    } else if (m.t === 'notice') {
      setNotice(m.message);
    } else if (m.t === 'error') {
      setError(m.message);
    } else if (m.t === 'closed') {
      setConn({ phase: 'offline' });
    }
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
    attachHandlers(net, urlRef.current);
    await net.connect(urlRef.current);
    rememberServer(urlRef.current);
    return net;
  };

  const send = (m: unknown) => {
    if (p2pRef.current) p2pRef.current(m);
    else netRef.current?.send(m);
  };
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

  const doLogin = async (username: string, password: string) => {
    setError('');
    setNotice('');
    if (!username.trim()) { setError('Inserisci lo username'); return; }
    try {
      const net = await ensureNet();
      net.send({ t: 'login', username: username.trim(), password });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const logout = () => {
    setAuth(null);
    setLastUsername('');
    setTotpPending(null);
    setTotpSetup(null);
  };

  // --- 2FA TOTP ---
  const doLoginTotp = async (username: string, password: string, code: string) => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'loginTotp', username: username.trim(), password, code: code.trim() });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doLoginTotpBackup = async (username: string, password: string, backupCode: string) => {
    setError('');
    try {
      const net = await ensureNet();
      net.send({ t: 'loginTotpBackup', username: username.trim(), password, backupCode: backupCode.trim() });
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

  const connect = async (opts: ConnectOpts) => {
    setError('');
    setConn({ phase: 'connecting' });
    try {
      const net = await ensureNet();
      if (lastUsernameRef.current) net.send({ t: 'login', username: lastUsernameRef.current });
      if (opts.mode === 'create') {
        net.send({ t: 'create', name: nameRef.current || 'Giocatore', password: opts.password, campaignName: opts.campaignName || 'Nuova campagna' });
      } else {
        net.send({ t: 'join', campaignId: opts.joinId, password: opts.password, name: nameRef.current || 'Giocatore', role: opts.asMaster ? 'master' : 'player' });
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
    if (connectWdRef.current) { clearTimeout(connectWdRef.current); connectWdRef.current = null; }
    netRef.current?.close();
    setConn({ phase: 'offline' });
  };

  const value: NetCtx = {
    conn, auth, error, setError, notice, setNotice, pingState, campaignList,
    url, setUrl, name, setName, servers, savedCampaigns,
    send, act, setConn, handleNetMessage: (m: any) => handleMsg(m), setP2PTransport,
    connect, disconnect, checkConnection, refreshCampaignList,
    doRegister, doLogin, logout,
    totpPending, totpSetup, doLoginTotp, doLoginTotpBackup, setupTotp, enableTotp, disableTotp,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNet(): NetCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNet fuori dal provider');
  return ctx;
}
