import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Character, CombatState } from '@dnd5e/core';
import { NetClient, defaultWsUrl } from './net.js';

export interface PlayerInfo {
  id: string;
  name: string;
  role: 'master' | 'player';
  characterId?: string;
}

export interface CampaignT {
  id: string;
  name: string;
  players: PlayerInfo[];
  characters: Record<string, Character>;
  combat: CombatState | null;
}

export type ConnState =
  | { phase: 'offline' }
  | { phase: 'connecting'; error?: string }
  | { phase: 'online'; campaign: CampaignT; you: PlayerInfo };

export interface AuthState {
  token: string;
  username: string;
  characters: Character[];
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
  connect: (opts: ConnectOpts) => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
  refreshCampaignList: () => Promise<void>;
  doRegister: (username: string, password: string) => Promise<void>;
  doLogin: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<NetCtx | null>(null);

export function NetProvider({ children }: { children: ReactNode }) {
  const netRef = useRef<NetClient | null>(null);
  const [conn, setConn] = useState<ConnState>({ phase: 'offline' });
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState('');
  const [pingState, setPingState] = useState<PingState>({ status: 'idle' });
  const [campaignList, setCampaignList] = useState<{ id: string; name: string; players: number }[]>([]);
  const [url, setUrlState] = useState(() => localStorage.getItem(URL_KEY) ?? defaultWsUrl());
  const [name, setNameState] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [lastUsername, setLastUsername] = useState('');
  const [servers, setServers] = useState<string[]>(loadServers);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaign[]>(loadJoined);
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

  const attachHandlers = (net: NetClient, serverUrl: string) => {
    net.onMessage((m) => {
      if (m.t === 'welcome') {
        setConn({ phase: 'online', campaign: m.campaign, you: m.you });
        rememberJoined({ server: serverUrl, id: m.campaign.id, name: m.campaign.name });
      } else if (m.t === 'state') {
        setConn((c) => (c.phase === 'online' ? { ...c, campaign: m.campaign } : c));
      } else if (m.t === 'campaigns') {
        setCampaignList(m.list);
      } else if (m.t === 'auth') {
        setAuth({ token: m.token, username: m.username, characters: m.characters });
        setLastUsername(m.username);
      } else if (m.t === 'campaignDeleted') {
        setConn({ phase: 'offline' });
        setError('La campagna è stata eliminata (dal master o dall\'admin).');
      } else if (m.t === 'error') {
        setError(m.message);
      } else if (m.t === 'closed') {
        setConn({ phase: 'offline' });
      }
    });
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

  const send = (m: unknown) => netRef.current?.send(m);
  const act = (action: unknown) => send({ t: 'action', action });

  const checkConnection = async () => {
    setPingState({ status: 'checking' });
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
    } catch (e) {
      setError((e as Error).message);
      setConn({ phase: 'offline' });
    }
  };

  const disconnect = () => {
    netRef.current?.close();
    setConn({ phase: 'offline' });
  };

  const value: NetCtx = {
    conn, auth, error, setError, pingState, campaignList,
    url, setUrl, name, setName, servers, savedCampaigns,
    send, act, connect, disconnect, checkConnection, refreshCampaignList,
    doRegister, doLogin, logout,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNet(): NetCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNet fuori dal provider');
  return ctx;
}
