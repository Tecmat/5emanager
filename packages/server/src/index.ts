import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { createRegistry, loadData, type Registry } from '@dnd5e/core';
import { SRD_DATA } from '@dnd5e/data-srd';
import type { Campaign, ClientMessage, PlayerInfo, ServerMessage } from './protocol.js';
import {
  addCustom,
  addPlayer,
  checkPassword,
  createCampaign,
  createCampaignAdmin,
  deleteCampaign,
  ensureDataDir,
  listCampaigns,
  listCampaignsDetailed,
  loadCampaign,
  removePlayer,
  saveCampaign,
  updateCampaign,
} from './campaign.js';
import {
  accountCharacters,
  accountRole,
  accountSavedP2PCampaigns,
  approveAccount,
  createSession,
  deleteAccount,
  deleteAccountCharacter,
  deleteAccountP2PCampaign,
  getAccount,
  listPending,
  loadAccountsFile,
  loginAccount,
  requestAccount,
  resetAccountPassword,
  rejectAccount,
  saveAccountCharacter,
  saveAccountP2PCampaign,
  sessionUsername,
  setAccountRole,
} from './accounts.js';
import { applyAction } from './combat-ops.js';
import { handleInfoApi, handleUpdateApi } from './update-api.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATIC_DIR = process.env.DND5E_STATIC_DIR ?? join(process.cwd(), 'apps', 'web', 'dist');
const ADMIN_PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'admin.html');
/** se impostata, il pannello admin (/admin) richiede questo token nei messaggi adminAuth */
const ADMIN_TOKEN = process.env.DND5E_ADMIN_TOKEN ?? '';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  // check-update lato server (funziona anche con repo privato se GITHUB_TOKEN è impostato)
  // /api/update/apply aggiorna la web app servita da questo server (POST, niente terminale)
  if (rawPath === '/api/update' || rawPath === '/api/update/asset' || rawPath === '/api/update/apply') {
    void handleUpdateApi(req, res);
    return;
  }
  if (rawPath === '/admin' || rawPath === '/admin.html') {
    if (existsSync(ADMIN_PAGE)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(ADMIN_PAGE));
    } else {
      res.writeHead(404);
      res.end('admin page non trovata');
    }
    return;
  }
  if (!existsSync(STATIC_DIR)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Web app non ancora buildata: esegui `npm run build -w @dnd5e/web`');
    return;
  }
  let path = rawPath;
  if (path === '/') path = '/index.html';
  const file = normalize(join(STATIC_DIR, path));
  if (!file.startsWith(normalize(STATIC_DIR)) || !existsSync(file) || !statSync(file).isFile()) {
    // fallback SPA
    const index = join(STATIC_DIR, 'index.html');
    if (existsSync(index)) {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(readFileSync(index));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

/** registry della campagna: SRD + custom del campaign */
function campaignRegistry(c: Campaign): Registry {
  const reg = createRegistry();
  loadData(reg, SRD_DATA);
  if (c.custom && Object.keys(c.custom).length > 0) loadData(reg, c.custom as never);
  return reg;
}

interface Conn {
  ws: WebSocket;
  /** id univoco della connessione (usato per il relay P2P) */
  id: string;
  campaignId?: string;
  playerId?: string;
  /** token di sessione account (dopo register/login) */
  token?: string;
  /** true dopo adminAuth riuscito */
  admin?: boolean;
}

const conns = new Set<Conn>();
const campaigns = new Map<string, Campaign>();

/**
 * elimina una campagna e disconnetti TUTTI i partecipanti (master incluso) insieme:
 * gli viene mandato campaignDeleted e poi il socket viene chiuso lato server.
 */
function disconnectCampaign(cid: string): void {
  for (const cc of conns) {
    if (cc.campaignId === cid) {
      send(cc.ws, { t: 'campaignDeleted', id: cid });
      cc.campaignId = undefined;
      cc.playerId = undefined;
      try { cc.ws.close(); } catch { /* già chiusa */ }
    }
  }
}

/** host P2P annunciati su questa rete: connId -> { name, at, ip } (in memoria, TTL 90s) */
const p2pHosts = new Map<string, { name: string; at: number; ip?: string }>();
const P2P_HOST_TTL_MS = 90_000;

/** codici invito brevi: code normalizzato -> { connId, at } (in memoria, TTL 90s) */
const p2pCodes = new Map<string, { connId: string; at: number }>();
const P2P_CODE_TTL_MS = 90_000;

/** normalizza un codice invito: maiuscole, senza trattini/spazi */
function normalizeP2PCode(c: unknown): string {
  return String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function p2pCleanCodes(): void {
  const now = Date.now();
  for (const [c, v] of p2pCodes) if (now - v.at > P2P_CODE_TTL_MS) p2pCodes.delete(c);
}

/** IP LAN del client dal socket del WebSocket (sans prefisso ::ffff:) */
function connIp(conn: Conn): string | undefined {
  const remote = (conn.ws as unknown as { _socket?: { remoteAddress?: string } })._socket?.remoteAddress;
  return remote?.replace(/^::ffff:/, '');
}

function p2pHostList(): { id: string; name: string; ip?: string }[] {
  const now = Date.now();
  for (const [id, h] of p2pHosts) if (now - h.at > P2P_HOST_TTL_MS) p2pHosts.delete(id);
  return [...p2pHosts.entries()].map(([id, h]) => ({ id, name: h.name, ip: h.ip }));
}

function broadcastP2PHosts(): void {
  const msg = JSON.stringify({ t: 'p2pHosts', hosts: p2pHostList() });
  for (const c of conns) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
}

function p2pRelay(conn: Conn, to: string, msg: object): void {
  const target = [...conns].find((c) => c.id === to);
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify({ ...msg, from: conn.id }));
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(campaign: Campaign): void {
  const msg: ServerMessage = { t: 'state', campaign };
  for (const c of conns) {
    if (c.campaignId === campaign.id) send(c.ws, msg);
  }
}

const STARTED_AT = new Date();

function sendAdminState(ws: WebSocket): void {
  const accounts = Object.values(loadAccountsFile().accounts);
  const pending = listPending();
  send(ws, {
    t: 'adminState',
    campaigns: listCampaignsDetailed(),
    accounts: accounts.map((a) => ({
      username: a.username,
      role: accountRole(a.username) ?? 'user',
      characters: Object.keys(a.characters).length,
      createdAt: a.createdAt,
    })),
    pending: pending.map((p) => ({ username: p.username, requestedAt: p.requestedAt })),
    server: {
      startedAt: STARTED_AT.toISOString(),
      uptimeSec: Math.floor((Date.now() - STARTED_AT.getTime()) / 1000),
      campaigns: listCampaignsDetailed().length,
      accounts: accounts.length,
      pending: pending.length,
      lan: lanAddresses(PORT),
    },
  });
}

function handleMessage(conn: Conn, raw: string): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.t === 'list') {
    send(conn.ws, { t: 'campaigns', list: listCampaigns() });
    return;
  }

  if (msg.t === 'ping') {
    send(conn.ws, { t: 'pong', id: msg.id, serverTime: Date.now() });
    return;
  }

  // ---- discovery P2P: relay di annunci e codici SDP (il gioco resta P2P diretto) ----
  if (msg.t === 'p2pAnnounce') {
    p2pHosts.set(conn.id, { name: String(msg.name || 'Host P2P'), at: Date.now(), ip: connIp(conn) });
    broadcastP2PHosts();
    return;
  }
  if (msg.t === 'p2pList') {
    send(conn.ws, { t: 'p2pHosts', hosts: p2pHostList() });
    return;
  }
  if (msg.t === 'p2pJoin') {
    const host = p2pHosts.get(String(msg.hostId));
    if (!host) {
      send(conn.ws, { t: 'error', message: 'Host non trovato (forse si è disconnesso)' });
      return;
    }
    // relay della richiesta con nome/password: in modalità relay (senza WebRTC) l'host risponde direttamente via p2pData
    p2pRelay(conn, String(msg.hostId), { t: 'p2pJoinRequest', name: msg.name, password: msg.password });
    // ack al giocatore: la richiesta è arrivata ed è stata inoltrata all'host
    send(conn.ws, { t: 'p2pJoinSent' });
    return;
  }
  if (msg.t === 'p2pAnnounceCode') {
    const code = normalizeP2PCode(msg.code);
    if (code.length < 6) {
      send(conn.ws, { t: 'error', message: 'Codice invito troppo corto (min 6 caratteri)' });
      return;
    }
    p2pCleanCodes();
    // un host ha un solo codice attivo alla volta
    for (const [c, v] of p2pCodes) if (v.connId === conn.id) p2pCodes.delete(c);
    p2pCodes.set(code, { connId: conn.id, at: Date.now() });
    // l'host entra anche nella lista normale (così appare anche lì)
    p2pHosts.set(conn.id, { name: String(msg.name || 'Host P2P'), at: Date.now(), ip: connIp(conn) });
    broadcastP2PHosts();
    send(conn.ws, { t: 'notice', message: 'Codice invito attivo: ' + code });
    return;
  }
  if (msg.t === 'p2pJoinCode') {
    const code = normalizeP2PCode(msg.code);
    p2pCleanCodes();
    const entry = p2pCodes.get(code);
    if (!entry) {
      send(conn.ws, { t: 'error', message: 'Codice invito non valido o scaduto (chiedi un nuovo codice all\'host)' });
      return;
    }
    const host = [...conns].find((c) => c.id === entry.connId);
    if (!host || host.ws.readyState !== WebSocket.OPEN) {
      send(conn.ws, { t: 'error', message: 'Host non raggiungibile (si è disconnesso)' });
      return;
    }
    // risolvi il codice in hostId per il client (serve al trasporto relay) e relay la richiesta
    send(conn.ws, { t: 'p2pCodeHost', hostId: host.id, name: p2pHosts.get(host.id)?.name });
    p2pRelay(conn, host.id, { t: 'p2pJoinRequest', name: msg.name, password: msg.password });
    send(conn.ws, { t: 'p2pJoinSent' });
    return;
  }
  if (msg.t === 'p2pData') {
    // relay opaque del traffico di gioco P2P (usato quando WebRTC non è disponibile, es. AppImage WebKitGTK)
    p2pRelay(conn, String(msg.to), { t: 'p2pData', data: String(msg.data ?? '') });
    return;
  }
  if (msg.t === 'p2pOffer') {
    const host = p2pHosts.get(conn.id);
    p2pRelay(conn, String(msg.to), { t: 'p2pOffer', name: host?.name ?? 'Host P2P', code: String(msg.code) });
    return;
  }
  if (msg.t === 'p2pAnswer') {
    p2pRelay(conn, String(msg.to), { t: 'p2pAnswer', code: String(msg.code) });
    return;
  }

  if (msg.t === 'register') {
    // la registrazione crea solo una RICHIESTA: l'admin la approva dal pannello /admin
    try {
      requestAccount(msg.username.trim(), msg.password);
      send(conn.ws, { t: 'notice', message: 'Richiesta di registrazione inviata per "' + msg.username.trim() + '": attendi l\'approvazione dell\'admin.' });
    } catch (e) {
      send(conn.ws, { t: 'error', message: (e as Error).message });
    }
    return;
  }

  if (msg.t === 'login') {
    try {
      const acc = loginAccount(msg.username.trim(), msg.password);
      conn.token = createSession(acc.username);
      // un account con ruolo admin entra direttamente nel pannello admin (senza DND5E_ADMIN_TOKEN)
      if (accountRole(acc.username) === 'admin') conn.admin = true;
      send(conn.ws, { t: 'auth', token: conn.token, username: acc.username, characters: accountCharacters(acc.username), savedCampaigns: accountSavedP2PCampaigns(acc.username) });
    } catch (e) {
      send(conn.ws, { t: 'error', message: (e as Error).message });
    }
    return;
  }

  if (msg.t === 'adminAuth') {
    if (ADMIN_TOKEN && msg.token !== ADMIN_TOKEN) {
      send(conn.ws, { t: 'error', message: 'Token admin non valido' });
      return;
    }
    conn.admin = true;
    sendAdminState(conn.ws);
    return;
  }

  if (msg.t === 'adminList' || msg.t === 'adminCreateCampaign' || msg.t === 'adminUpdateCampaign' || msg.t === 'adminDeleteCampaign' || msg.t === 'adminDeleteAccount' || msg.t === 'adminApproveAccount' || msg.t === 'adminRejectAccount' || msg.t === 'adminDeleteCharacter' || msg.t === 'adminSetRole' || msg.t === 'adminResetPassword' || msg.t === 'adminCampaignDetail' || msg.t === 'adminKickPlayer' || msg.t === 'adminBroadcast') {
    if (!conn.admin) {
      send(conn.ws, { t: 'error', message: 'Non autorizzato: fai prima adminAuth (pannello /admin)' });
      return;
    }
    try {
      if (msg.t === 'adminCreateCampaign') {
        if (!msg.name.trim()) throw new Error('Nome campagna mancante');
        const c = createCampaignAdmin(msg.name.trim(), msg.password ?? '');
        campaigns.set(c.id, c);
      }
      if (msg.t === 'adminUpdateCampaign') {
        const next = updateCampaign(msg.id, { name: msg.name, password: msg.password });
        campaigns.set(next.id, next);
      }
      if (msg.t === 'adminDeleteCampaign') {
        if (!deleteCampaign(msg.id)) throw new Error('Campagna non trovata: ' + msg.id);
        campaigns.delete(msg.id);
        disconnectCampaign(msg.id);
      }
      if (msg.t === 'adminDeleteAccount') deleteAccount(msg.username);
      if (msg.t === 'adminApproveAccount') approveAccount(msg.username);
      if (msg.t === 'adminRejectAccount') rejectAccount(msg.username);
      if (msg.t === 'adminDeleteCharacter') deleteAccountCharacter(msg.username, msg.characterId);
      if (msg.t === 'adminSetRole') setAccountRole(msg.username, msg.role === 'admin' ? 'admin' : 'user');
      if (msg.t === 'adminResetPassword') resetAccountPassword(msg.username, msg.password);
      if (msg.t === 'adminCampaignDetail') {
        const c = campaigns.get(msg.id) ?? loadCampaign(msg.id);
        if (!c) throw new Error('Campagna non trovata: ' + msg.id);
        send(conn.ws, {
          t: 'adminCampaign',
          id: c.id,
          name: c.name,
          players: c.players,
          characters: Object.keys(c.characters).length,
          inCombat: !!c.combat,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        });
      }
      if (msg.t === 'adminKickPlayer') {
        const c = campaigns.get(msg.campaignId) ?? loadCampaign(msg.campaignId);
        if (!c) throw new Error('Campagna non trovata: ' + msg.campaignId);
        const kickCampaignId = msg.campaignId;
        const kickPlayerId = msg.playerId;
        const victim = [...conns].find((x) => x.campaignId === kickCampaignId && x.playerId === kickPlayerId);
        if (victim) {
          send(victim.ws, { t: 'kicked' });
          victim.campaignId = undefined;
          victim.playerId = undefined;
          try { victim.ws.close(); } catch { /* già chiusa */ }
        }
        const next = removePlayer(c, kickPlayerId);
        campaigns.set(next.id, next);
        broadcast(next);
      }
      if (msg.t === 'adminBroadcast') {
        // messaggio "notice" a tutti i client connessi (utile per avvisare di manutenzioni/aggiornamenti)
        const notice: ServerMessage = { t: 'notice', message: '[admin] ' + msg.message };
        for (const c of conns) send(c.ws, notice);
      }
    } catch (e) {
      send(conn.ws, { t: 'error', message: (e as Error).message });
      return;
    }
    sendAdminState(conn.ws);
    return;
  }

  if (msg.t === 'adminAccountDetail') {
    if (!conn.admin) {
      send(conn.ws, { t: 'error', message: 'Non autorizzato: fai prima adminAuth (pannello /admin)' });
      return;
    }
    const chars = accountCharacters(msg.username).map((ch) => ({
      id: ch.id,
      name: ch.name,
      level: ch.classLevels.reduce((s, c) => s + c.level, 0),
      updatedAt: ch.updatedAt,
    }));
    send(conn.ws, { t: 'adminAccount', username: msg.username, characters: chars });
    return;
  }

  if (msg.t === 'create') {
    const player: PlayerInfo = { id: randomUUID(), name: msg.name, role: 'master' };
    const c = createCampaign(msg.campaignName, msg.password, player);
    campaigns.set(c.id, c);
    conn.campaignId = c.id;
    conn.playerId = player.id;
    conns.add(conn);
    send(conn.ws, { t: 'welcome', you: player, campaign: c });
    return;
  }

  if (msg.t === 'join') {
    const c = campaigns.get(msg.campaignId) ?? loadCampaign(msg.campaignId);
    if (!c) {
      send(conn.ws, { t: 'error', message: 'Campagna non trovata: ' + msg.campaignId });
      return;
    }
    if (!checkPassword(c, msg.password)) {
      send(conn.ws, { t: 'error', message: 'Password sbagliata' });
      return;
    }
    campaigns.set(c.id, c);
    // rientro come master: concesso se non c'è già un master collegato (la password della campagna protegge l'accesso)
    if (msg.role === 'master' && c.players.some((p) => p.role === 'master')) {
      send(conn.ws, { t: 'error', message: 'C\'è già un master collegato in questa campagna' });
      return;
    }
    const player: PlayerInfo = { id: randomUUID(), name: msg.name, role: msg.role === 'master' ? 'master' : 'player' };
    addPlayer(c, player);
    conn.campaignId = c.id;
    conn.playerId = player.id;
    conns.add(conn);
    send(conn.ws, { t: 'welcome', you: player, campaign: c });
    broadcast(c);
    return;
  }

  if (msg.t === 'action') {
    if (msg.action.kind === 'saveCharacter' || msg.action.kind === 'deleteCharacter' || msg.action.kind === 'saveP2PCampaign' || msg.action.kind === 'deleteP2PCampaign') {
      const token = conn.token;
      const username = token ? sessionUsername(token) : undefined;
      if (!token || !username) {
        send(conn.ws, { t: 'error', message: 'Devi fare login (account) prima di salvare le schede' });
        return;
      }
      try {
        if (msg.action.kind === 'saveCharacter') saveAccountCharacter(username, msg.action.character);
        else if (msg.action.kind === 'deleteCharacter') deleteAccountCharacter(username, msg.action.characterId);
        else if (msg.action.kind === 'saveP2PCampaign') saveAccountP2PCampaign(username, msg.action.saved);
        else deleteAccountP2PCampaign(username, msg.action.id);
      } catch (e) {
        send(conn.ws, { t: 'error', message: (e as Error).message });
        return;
      }
      send(conn.ws, { t: 'auth', token, username, characters: accountCharacters(username), savedCampaigns: accountSavedP2PCampaigns(username) });
      return;
    }
    if (!conn.campaignId || !conn.playerId) {
      send(conn.ws, { t: 'error', message: 'Non sei dentro una campagna: entra o creane una' });
      return;
    }
    let c = campaigns.get(conn.campaignId);
    if (!c) {
      send(conn.ws, { t: 'error', message: 'Campagna non caricata' });
      return;
    }
    if (msg.action.kind === 'useCharacter') {
      const username = conn.token ? sessionUsername(conn.token) : undefined;
      const lib = username ? getAccount(username)?.characters ?? {} : {};
      const ch = lib[msg.action.characterId];
      if (!ch) {
        send(conn.ws, { t: 'error', message: 'Scheda non trovata nella libreria dell\'account' });
        return;
      }
      msg.action = { kind: 'setCharacter', character: ch };
    }
    if (msg.action.kind === 'deleteCampaign') {
      const player = c.players.find((p) => p.id === conn.playerId);
      if (player?.role !== 'master') {
        send(conn.ws, { t: 'error', message: 'Solo il master può eliminare la campagna' });
        return;
      }
      const cid = c.id;
      campaigns.delete(cid);
      deleteCampaign(cid);
      disconnectCampaign(cid);
      return;
    }
    const reg = campaignRegistry(c);
    const action = msg.action;
    const [next, err] = applyAction(c, conn.playerId, reg, action);
    if (err) {
      send(conn.ws, { t: 'error', message: err });
      return;
    }
    campaigns.set(next.id, next);
    broadcast(next);
    // kick: disconnetti subito il giocatore espulso
    if (action.kind === 'kickPlayer') {
      const victim = [...conns].find((x) => x.campaignId === next.id && x.playerId === action.playerId);
      if (victim) {
        send(victim.ws, { t: 'kicked' });
        victim.campaignId = undefined;
        victim.playerId = undefined;
        try { victim.ws.close(); } catch { /* già chiusa */ }
      }
    }
  }
}

export function createDndServer(port = PORT, host = HOST) {
  ensureDataDir();
  // /api/info serve alla scansione LAN automatica (le app sondano la rete e trovano i server 5emanager)
  let infoHandler: (req: IncomingMessage, res: ServerResponse) => boolean = () => false;
  const http = createServer((req, res) => {
    if (infoHandler(req, res)) return;
    serveStatic(req, res);
  });
  const wss = new WebSocketServer({ server: http, maxPayload: 4 * 1024 * 1024 });

  wss.on('connection', (ws) => {
    const conn: Conn = { ws, id: 'c-' + Math.random().toString(36).slice(2, 10) };
    conns.add(conn);
    ws.on('message', (data) => {
      try {
        handleMessage(conn, data.toString());
      } catch (e) {
        send(ws, { t: 'error', message: 'Errore interno: ' + (e as Error).message });
      }
    });
    ws.on('close', () => {
      conns.delete(conn);
      if (p2pHosts.delete(conn.id)) broadcastP2PHosts();
      for (const [c, v] of p2pCodes) if (v.connId === conn.id) p2pCodes.delete(c);
      if (conn.campaignId && conn.playerId) {
        const c = campaigns.get(conn.campaignId);
        if (c) {
          const next = removePlayer(c, conn.playerId);
          campaigns.set(next.id, next);
          broadcast(next);
        }
      }
    });
  });

  return new Promise<{ http: typeof http; wss: WebSocketServer; port: number }>((resolve) => {
    http.listen(port, host, () => {
      const address = http.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      infoHandler = handleInfoApi(actualPort, lanAddresses(actualPort));
      resolve({ http, wss, port: actualPort });
    });
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '');
export function lanAddresses(port: number): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(`${i.address}:${port}`);
    }
  }
  return out;
}

if (process.argv[1]?.includes('server/src/index')) {
  createDndServer().then(({ port }) => {
    console.log(`🎲 5e Manager server in ascolto su http://${HOST}:${port}`);
    for (const addr of lanAddresses(port)) {
      console.log(`   📱 LAN: http://${addr}/   (WebSocket: ws://${addr})`);
    }
    console.log(`   Web app: http://localhost:${port}/  (build: npm run build -w @dnd5e/web)`);
  });
}
