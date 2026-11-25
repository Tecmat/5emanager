import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { createRegistry, loadData, setPlayerOnline, type Registry } from '@dnd5e/core';
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
  hashPassword,
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
  accountTotpEnabled,
  ADMIN_USER,
  USERNAME_RE,
  checkInvite,
  countActiveSessions,
  createAccountFromInvite,
  createInvite,
  createRememberToken,
  listDevices,
  listInvites,
  revokeAllSessions,
  revokeInvite,
  revokeRememberToken,
  revokeRememberTokens,
  deleteSession,
  loginByRememberToken,
  registrationMode,
  setRegistrationMode,
  type Account,
  addAccountPasskey,
  adminClearPasskeys,
  adminDisableTotp,
  approveAccount,
  consumeBackupCode,
  createSession,
  deleteAccount,
  deleteAccountCharacter,
  deleteAccountP2PCampaign,
  disableAccountTotp,
  enableAccountTotp,
  findPasskeyOwner,
  getAccount,
  getAccountPasskey,
  listAccountPasskeys,
  listPending,
  loadAccountsFile,
  loginAccount,
  noteLogin,
  removeAccountPasskey,
  requestAccount,
  resetAccountPassword,
  saveAccountsFile,
  rejectAccount,
  saveAccountCharacter,
  saveAccountP2PCampaign,
  sessionUsername,
  setAccountRole,
  setupAccountTotp,
  setupRequired,
  updatePasskeyCounter,
  verifyAccountTotp,
  type StoredPasskey,
} from './accounts.js';
import {
  authenticationOptionsFor,
  registrationOptionsFor,
  rpConfigFromHost,
  toWebAuthnCredential,
  verifyAuthentication,
  verifyRegistration,
} from './passkeys.js';
import { applyAction } from './combat-ops.js';
import { handleInfoApi, handleUpdateApi } from './update-api.js';
import { handleSetupApi, serveSetupPage } from './setup-api.js';
import { audit, readAudit } from './audit.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
/**
 * DND5E_REQUIRE_AUTH=true: la webapp servita da questo server (es. Docker) richiede un account:
 * senza cookie di sessione valido si serve solo la pagina di login, e sui WS create/join/action
 * serve la sessione. Le app native (Tauri/Capacitor) non passano da qui: restano indipendenti.
 */
const REQUIRE_AUTH = (process.env.DND5E_REQUIRE_AUTH ?? '').trim().toLowerCase() === 'true';
const ADMIN_USER_ENV = ADMIN_USER;
/** messaggi WS sempre permessi anche con REQUIRE_AUTH (sono l'autenticazione stessa) */
const AUTH_FREE_MSGS = new Set(['login', 'loginToken', 'register', 'loginTotp', 'loginTotpBackup', 'ping', 'passkeyLoginStart', 'passkeyLoginFinish']);
const SESSION_COOKIE = 'dnd5e_session';

/** parse dei cookie della richiesta HTTP */
function cookieOf(req: IncomingMessage, name: string): string | undefined {
  const raw = String(req.headers.cookie ?? '');
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** true se la richiesta arriva su HTTPS (TLS diretto o reverse proxy che passa X-Forwarded-Proto: https) */
function isSecureReq(req: IncomingMessage): boolean {
  if ((req.socket as unknown as { encrypted?: boolean }).encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

/** IP del client (per il rate limit dei login) */
function clientIpOf(req: IncomingMessage): string {
  return String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
}

// --- allowlist IP delle superfici admin (DND5E_ADMIN_ALLOWLIST="192.168.1.0/24,10.0.0.5") ---
function ipv4ToNum(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

/** ip corrisponde a una entry della lista (IP esatto o CIDR IPv4, es. 10.0.0.0/8) */
function ipInList(ip: string, list: string[]): boolean {
  return list.some((entry) => {
    if (!entry.includes('/')) return ip === entry;
    const [base, bitsStr] = entry.split('/');
    const bits = Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const ipN = ipv4ToNum(ip);
    const baseN = ipv4ToNum(base);
    if (ipN === null || baseN === null) return false;
    if (bits === 0) return true;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (ipN & mask) === (baseN & mask);
  });
}

function adminAllowlist(): string[] {
  return (process.env.DND5E_ADMIN_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function trustXff(): boolean {
  return (process.env.DND5E_TRUST_XFF ?? '').trim().toLowerCase() === 'true';
}

/**
 * true se l'IP puo' accedere alle superfici admin (/admin, adminAuth WS, /api/update/apply).
 * Senza DND5E_ADMIN_ALLOWLIST non si filtra nulla. Dietro reverse proxy: il socket vede l'IP del
 * proxy, quindi per un allowlist per-client impostare DND5E_TRUST_XFF=true e usare X-Forwarded-For.
 */
function adminIpAllowed(ip: string | undefined, xff?: string): boolean {
  const list = adminAllowlist();
  if (list.length === 0) return true;
  if (ip && ipInList(ip, list)) return true;
  if (trustXff() && xff) {
    const chain = xff.split(',').map((s) => s.trim().replace(/^::ffff:/, '')).filter(Boolean);
    if (chain.some((c) => ipInList(c, list))) return true;
  }
  return false;
}

function adminIpAllowedReq(req: IncomingMessage): boolean {
  return adminIpAllowed(clientIpOf(req), String(req.headers['x-forwarded-for'] ?? ''));
}

/**
 * Header di sicurezza su TUTTE le risposte HTTP (utile quando il server e' esposto su HTTPS
 * dietro reverse proxy): nosniff, no-referrer, anti-clickjacking, CSP restrittiva ma
 * compatibile con le pagine standalone (script inline) e con la webapp (ws/wss verso LAN,
 * immagini data:/blob: per i ritratti). HSTS solo se la richiesta e' HTTPS.
 */
function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss: http: https:",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "worker-src 'self'",
    ].join('; '),
  );
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (isSecureReq(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/** normalizza un host per il confronto degli origin ( toglie le porte di default 80/443 ) */
function normHost(h: string): string {
  return h.trim().toLowerCase().replace(/:443$/, '').replace(/:80$/, '');
}

function isLocalHostName(h: string): boolean {
  return /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/.test(h);
}

/**
 * Controllo Origin sull'upgrade WebSocket (anti cross-site WebSocket hijacking, primo avvio
 * su server pubblico): un client non-browser (app native, test, curl) non manda Origin -> ok;
 * le app native Capacitor girano su https://localhost -> ok; il browser deve avere un origin
 * che combacia con Host (o X-Forwarded-Host, o DND5E_RP_ORIGIN dietro proxy che non passa Host).
 */
function wsOriginAllowed(req: IncomingMessage): boolean {
  const origin = String(req.headers.origin ?? '').trim();
  if (!origin) return true;
  if (origin === 'null') return false;
  let originHost = '';
  try {
    originHost = normHost(new URL(origin).host);
  } catch {
    return false;
  }
  if (isLocalHostName(originHost)) return true;
  if (originHost && originHost === normHost(String(req.headers.host ?? ''))) return true;
  const xfh = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
  if (xfh && originHost === normHost(xfh)) return true;
  const rpOrigin = (process.env.DND5E_RP_ORIGIN ?? '').trim();
  return !!rpOrigin && origin === rpOrigin;
}

/** token di sessione valido dalla richiesta (cookie di sessione in memoria o token "mantieni l'accesso") */
function sessionTokenOf(req: IncomingMessage): string | undefined {
  const tok = cookieOf(req, SESSION_COOKIE);
  if (!tok) return undefined;
  if (sessionUsername(tok)) return tok;
  const acc = loginByRememberToken(tok);
  if (acc) {
    const t = createSession(acc.username);
    return t; // il token remember vale come sessione; la cookie resta il remember token
  }
  return undefined;
}

/** setta il cookie di sessione (remember -> 30 giorni, altrimenti cookie di sessione); Secure se la richiesta e' HTTPS */
function setSessionCookie(res: ServerResponse, token: string, remember: boolean, secure: boolean): void {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (remember) parts.push(`Max-Age=${30 * 24 * 3600}`);
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/** path pubblici anche con REQUIRE_AUTH (login, setup, info, update check). /admin NO: ha il suo gate sotto */
function isPublicPath(path: string): boolean {
  return (
    path === '/login' || path === '/login.html' ||
    path === '/api/login' || path === '/api/login-token' || path === '/api/register' ||
    path === '/api/passkey/options' || path === '/api/passkey/verify' ||
    path === '/api/logout' || path === '/api/me' || path === '/api/info' ||
    path === '/api/setup' || path === '/setup' || path === '/setup.html' ||
    path === '/invite' || path === '/invite.html' || path === '/api/invite' ||
    path === '/version.json' || path === '/api/update' || path === '/api/update/asset' ||
    path === '/.well-known/security.txt'
  );
}
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
  serveStaticNext(req, res);
}

/**
 * Gate della pagina /admin: la vede SOLO chi ha una sessione cookie con ruolo admin oppure,
 * se il server non usa REQUIRE_AUTH e ha DND5E_ADMIN_TOKEN, chi passa il token (?token= o header
 * x-admin-token). Senza sessione con REQUIRE_AUTH -> redirect al login; sessione non-admin -> 403.
 * Senza REQUIRE_AUTH e senza token resta aperta SOLO se non esistono ancora account (LAN fresca).
 */
function adminPageDecision(req: IncomingMessage): 'serve' | 'login' | 'forbidden' {
  // allowlist IP: se impostata e l'IP non è in lista, /admin è 403 a prescindere da sessione/token
  if (!adminIpAllowedReq(req)) return 'forbidden';
  const tok = sessionTokenOf(req);
  const uname = tok ? sessionUsername(tok) ?? loginByRememberToken(tok)?.username : undefined;
  if (uname) return accountRole(uname) === 'admin' ? 'serve' : 'forbidden';
  if (REQUIRE_AUTH) return 'login';
  if (ADMIN_TOKEN) {
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token') ?? '';
    const h = String(req.headers['x-admin-token'] ?? '');
    return (q !== '' && q === ADMIN_TOKEN) || (h !== '' && h === ADMIN_TOKEN) ? 'serve' : 'forbidden';
  }
  return Object.keys(loadAccountsFile().accounts).length === 0 ? 'serve' : 'forbidden';
}

/** pagina 403 minimale per /admin: chi non e' admin non vede nemmeno il pannello */
function serveAdminForbidden(res: ServerResponse): void {
  res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(
    '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>403 — 5e Manager</title></head>' +
    '<body style="margin:0;font:15px/1.5 system-ui,sans-serif;background:#14110d;color:#ece4d4;display:flex;min-height:100vh;align-items:center;justify-content:center;background-image:linear-gradient(rgba(201,162,39,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(201,162,39,.05) 1px,transparent 1px);background-size:26px 26px">' +
    '<div style="max-width:440px;text-align:center;padding:26px;background:#201b15;border:1px solid #3e352a;border-top:2px solid rgba(201,162,39,.5);border-radius:14px">' +
    '<h1 style="font-size:20px;margin:0 0 8px;color:#c9a227;font-family:Georgia,serif">🔒 403 — Area riservata agli admin</h1>' +
    '<p style="color:#a3947c">Per aprire il pannello devi essere loggato con un account <b>admin</b>' +
    (ADMIN_TOKEN ? ' (oppure aprirlo come <code style="background:#14110d;border:1px solid #3e352a;padding:1px 6px;border-radius:6px">/admin?token=…</code> con il token admin)' : '') + '.</p>' +
    '<p><a href="/" style="color:#c9a227">⬅️ App</a>' + (REQUIRE_AUTH ? ' &nbsp;·&nbsp; <a href="/login" style="color:#c9a227">Login</a>' : '') + '</p></div></body></html>',
  );
}

function serveStaticNext(req: IncomingMessage, res: ServerResponse): void {
  const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  // PRIMO AVVIO senza account: mostra subito il setup admin (creazione primo admin) invece dell'app/login/admin
  if (REQUIRE_AUTH && req.method === 'GET' && setupRequired() && (rawPath === '/' || rawPath === '/login' || rawPath === '/login.html' || rawPath === '/admin' || rawPath === '/admin.html' || rawPath === '/invite' || rawPath === '/invite.html')) {
    res.writeHead(302, { location: '/setup' });
    res.end();
    return;
  }
  // pagina di login standalone del server: su /login MAI servire l'SPA (loop con il redirect di /api/me).
  // Sessione valida -> 302 all'app; senza sessione -> pagina di login temata.
  if (REQUIRE_AUTH && (rawPath === '/login' || rawPath === '/login.html')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('usa GET');
      return;
    }
    const tok = sessionTokenOf(req);
    if (tok && (sessionUsername(tok) ?? loginByRememberToken(tok)?.username)) {
      res.writeHead(302, { location: '/' });
      res.end();
      return;
    }
    serveLoginPage(res);
    return;
  }
  // /admin ha il suo gate: MAI pubblica — vedi adminPageDecision (anche /admin/ con slash finale)
  if (rawPath === '/admin' || rawPath === '/admin/' || rawPath === '/admin.html') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('usa GET');
      return;
    }
    const decision = adminPageDecision(req);
    if (decision === 'login') {
      res.writeHead(302, { location: '/login' });
      res.end();
      return;
    }
    if (decision === 'forbidden') {
      serveAdminForbidden(res);
      return;
    }
    if (existsSync(ADMIN_PAGE)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(ADMIN_PAGE));
    } else {
      res.writeHead(404);
      res.end('admin page non trovata');
    }
    return;
  }
  // DND5E_REQUIRE_AUTH: senza sessione valida si serve SOLO la pagina di login (niente app)
  if (REQUIRE_AUTH && req.method === 'GET' && !isPublicPath(rawPath) && !sessionTokenOf(req)) {
    serveLoginPage(res);
    return;
  }
  // check-update lato server (funziona anche con repo privato se GITHUB_TOKEN è impostato)
  // /api/update/apply aggiorna la web app servita da questo server (POST, niente terminale)
  if (rawPath === '/api/update' || rawPath === '/api/update/asset' || rawPath === '/api/update/apply') {
    // self-update (apply): con REQUIRE_AUTH serve una sessione admin o un x-admin-token valido
    if (rawPath === '/api/update/apply' && REQUIRE_AUTH) {
      const tok = sessionTokenOf(req);
      const uname = tok ? sessionUsername(tok) : undefined;
      const adminSession = !!uname && accountRole(uname) === 'admin';
      const tokenOk = ADMIN_TOKEN !== '' && String(req.headers['x-admin-token'] ?? '') === ADMIN_TOKEN;
      if (!adminSession && !tokenOk) {
        res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'Non autorizzato: self-update riservato agli admin (sessione admin o x-admin-token)' }));
        return;
      }
    }
    if (rawPath === '/api/update/apply' && !adminIpAllowedReq(req)) {
      res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'IP non autorizzato (DND5E_ADMIN_ALLOWLIST)' }));
      return;
    }
    void handleUpdateApi(req, res);
    return;
  }
  if (rawPath === '/api/setup') {
    void handleSetupApi(req, res).then((handled) => { if (!handled) serveStaticNext(req, res); });
    return;
  }
  if (rawPath === '/setup' || rawPath === '/setup.html') {
    if (!serveSetupPage(res)) {
      res.writeHead(404);
      res.end('setup page non trovata');
    }
    return;
  }
  // security.txt (RFC 9116): sempre pubblico, anche con REQUIRE_AUTH
  if (rawPath === '/.well-known/security.txt') {
    const sec = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'security.txt');
    try {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' });
      res.end(readFileSync(sec));
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }
  // pagina pubblica del link di invito (registrazione "solo su invito")
  if (rawPath === '/invite' || rawPath === '/invite.html') {
    if (existsSync(INVITE_PAGE)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(INVITE_PAGE));
    } else {
      res.writeHead(404);
      res.end('invite page non trovata');
    }
    return;
  }
  // GET /api/invite?token=… -> validita'; POST /api/invite {token,username,password,remember} -> crea account (monouso) + cookie
  if (rawPath === '/api/invite') {
    void handleInviteApi(req, res).then((handled) => { if (!handled) serveStaticNext(req, res); });
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
      res.end(injectServerMarker(readFileSync(index, 'utf8')));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }
  const ext = extname(file);
  if (ext === '.html') {
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(injectServerMarker(readFileSync(file, 'utf8')));
    return;
  }
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

/**
 * Inietta nella pagina HTML della webapp un meta marker "servita dal server":
 * la SPA lo legge per comportarsi da webapp del server (niente P2P, sessione cookie)
 * in modo robusto e CSP-safe, senza euristiche sull'origin (che sbagliano su Tauri:
 * tauri://localhost / http://tauri.localhost). Le pagine standalone in public/ non lo ricevono.
 */
function injectServerMarker(html: string): string {
  if (html.includes('name="dnd5e-server"')) return html;
  const meta = '<meta name="dnd5e-server" content="1">';
  const m = /<head[^>]*>/i.exec(html);
  if (m && m.index !== undefined) return html.slice(0, m.index + m[0].length) + meta + html.slice(m.index + m[0].length);
  return meta + html;
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
  /** header Host della richiesta WS: da qui deriviamo RP ID/origin delle passkey */
  rpHost?: string;
  /** X-Forwarded-For dell'upgrade (se presente e DND5E_TRUST_XFF=true, conta per l'allowlist admin) */
  xff?: string;
  /** challenge WebAuthn in corso su questa connessione (register/login passkey) */
  passkeyChallenge?: { kind: 'register' | 'login'; challenge: string; username?: string };
}

const conns = new Set<Conn>();
const campaigns = new Map<string, Campaign>();

/**
 * token di rientro dei giocatori (in memoria): token -> { campaignId, playerId }.
 * Il client lo manda in create/join e lo tiene in localStorage per campagna: dopo un drop
 * di rete rientra con lo stesso playerId (scheda compresa) senza reinserire la password.
 */
const rejoinTokens = new Map<string, { campaignId: string; playerId: string }>();
/** grace period: dopo la disconnessione il giocatore resta "offline" (online=false) per TOT ms, poi viene rimosso */
const REJOIN_GRACE_MS = Number(process.env.DND5E_REJOIN_GRACE_MS ?? 60_000);
const offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();

function rejoinKey(campaignId: string, playerId: string): string {
  return campaignId + ':' + playerId;
}

function dropRejoinToken(campaignId: string, playerId: string): void {
  for (const [tok, v] of rejoinTokens) if (v.campaignId === campaignId && v.playerId === playerId) rejoinTokens.delete(tok);
}

/** dopo la disconnessione: marca offline e programma la rimozione dopo il grace period */
function scheduleOfflineRemoval(campaignId: string, playerId: string): void {
  const key = rejoinKey(campaignId, playerId);
  const prev = offlineTimers.get(key);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    offlineTimers.delete(key);
    const c = campaigns.get(campaignId);
    if (!c) return;
    const p = c.players.find((x) => x.id === playerId);
    const attached = [...conns].some((x) => x.campaignId === campaignId && x.playerId === playerId);
    if (p && p.online === false && !attached) {
      const next = removePlayer(c, playerId);
      campaigns.set(next.id, next);
      broadcast(next);
    }
  }, REJOIN_GRACE_MS);
  offlineTimers.set(key, timer);
}

/**
 * elimina una campagna e disconnetti TUTTI i partecipanti (master incluso) insieme:
 * gli viene mandato campaignDeleted e poi il socket viene chiuso lato server.
 */
function disconnectCampaign(cid: string): void {
  for (const [tok, v] of rejoinTokens) if (v.campaignId === cid) rejoinTokens.delete(tok);
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

// throttle tentativi 2FA: max 5 codici/minuto per username (in memoria)
const totpAttempts = new Map<string, number[]>();
function totpThrottled(username: string): boolean {
  const now = Date.now();
  const arr = (totpAttempts.get(username) ?? []).filter((t) => now - t < 60_000);
  totpAttempts.set(username, arr);
  return arr.length >= 5;
}
function totpNoteAttempt(username: string): void {
  const now = Date.now();
  const arr = (totpAttempts.get(username) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  totpAttempts.set(username, arr);
}

// throttle tentativi di login con password: max N falliti/minuto per chiave (DND5E_LOGIN_MAX_ATTEMPTS, default 10).
// Si contano solo i fallimenti: un login riuscito azzera il contatore.
const loginAttempts = new Map<string, number[]>();
/** challenge passkey emessi via HTTP (/api/passkey/options), validi 3 minuti */
const pkChallenges = new Map<string, { username?: string; at: number }>();
function envInt(name: string, def: number): number {
  const n = Number(process.env[name] ?? def);
  return Number.isFinite(n) && n > 0 ? n : def;
}
function loginMaxAttempts(): number {
  return envInt('DND5E_LOGIN_MAX_ATTEMPTS', 10);
}
function loginThrottled(key: string, max?: number): boolean {
  const now = Date.now();
  const arr = (loginAttempts.get(key) ?? []).filter((t) => now - t < 60_000);
  loginAttempts.set(key, arr);
  return arr.length >= (max ?? loginMaxAttempts());
}
function loginNoteAttempt(key: string): void {
  const now = Date.now();
  const arr = (loginAttempts.get(key) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  loginAttempts.set(key, arr);
}

/** attore per l'audit log: username della sessione, oppure 'admin-token'/'ip:…' se anonimo */
function connActor(conn: Conn): string {
  const un = conn.token ? sessionUsername(conn.token) : undefined;
  return un ?? (conn.admin ? 'admin-token' : 'ip:' + (connIp(conn) ?? '?'));
}

/** dettaglio compatto per l'audit log delle azioni admin (mai password/token) */
function adminDetail(msg: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const k of ['username', 'id', 'name', 'role', 'mode', 'inviteId', 'campaignId', 'playerId', 'message', 'ttlHours', 'tokenId']) {
    const v = msg[k];
    if (v !== undefined && v !== '') parts.push(`${k}=${String(v).slice(0, 120)}`);
  }
  return parts.join(' ') || undefined;
}

/** manda il messaggio auth completo (con ruolo) dopo un login riuscito */
function sendAuth(ws: WebSocket, token: string, username: string, totpEnabled: boolean, rememberToken?: string): void {
  send(ws, {
    t: 'auth',
    token,
    username,
    role: accountRole(username) ?? 'user',
    characters: accountCharacters(username),
    savedCampaigns: accountSavedP2PCampaigns(username),
    totpEnabled,
    registration: registrationMode(),
    rememberToken,
  });
}

/** corpo JSON di risposta auth riutilizzato anche dall'API HTTP /api/login */
function authJson(token: string, username: string, rememberToken?: string) {
  return {
    ok: true,
    token,
    username,
    role: accountRole(username) ?? 'user',
    totpEnabled: accountTotpEnabled(username),
    rememberToken,
  };
}

// ---------------------------------------------------------------------------
// API HTTP di autenticazione (usate dalla pagina di login servita con DND5E_REQUIRE_AUTH)
// ---------------------------------------------------------------------------

function readJsonBody(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('body troppo grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('JSON non valido')); }
    });
    req.on('error', reject);
  });
}

/** gestisce /api/login, /api/login-token, /api/register, /api/logout, /api/me. Ritorna true se servita. */
async function handleAuthApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!['/api/login', '/api/login-token', '/api/register', '/api/logout', '/api/me', '/api/passkey/options', '/api/passkey/verify'].includes(path)) return false;
  const secure = isSecureReq(req);
  const json = (code: number, obj: unknown, token?: string, remember = false) => {
    if (token) setSessionCookie(res, token, remember, secure);
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  if (path === '/api/me') {
    const tok = sessionTokenOf(req) ?? cookieOf(req, SESSION_COOKIE);
    const username = tok ? (sessionUsername(tok) ?? loginByRememberToken(tok)?.username) : undefined;
    if (!username) return void json(401, { error: 'non autenticato', requireAuth: REQUIRE_AUTH }), true;
    return void json(200, { username, role: accountRole(username) ?? 'user', totpEnabled: accountTotpEnabled(username), requireAuth: REQUIRE_AUTH, registration: registrationMode() }), true;
  }

  if (path === '/api/logout') {
    const tok = cookieOf(req, SESSION_COOKIE);
    const uname = tok ? sessionUsername(tok) ?? loginByRememberToken(tok)?.username : undefined;
    if (uname) audit(uname, 'logout', undefined, clientIpOf(req));
    if (tok) deleteSession(tok);
    const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
    return void json(200, { ok: true }), true;
  }

  // --- login con passkey via HTTP (pagina /login standalone, senza WS) ---
  // challenge emessi da /api/passkey/options, validi 3 minuti
  const pkPrune = () => { const now = Date.now(); for (const [k, v] of pkChallenges) if (now - v.at > 180_000) pkChallenges.delete(k); };
  const rpOfReq = (req2: IncomingMessage) => rpConfigFromHost(String(req2.headers['x-forwarded-host'] ?? req2.headers.host ?? ''));

  if (path === '/api/passkey/options') {
    if (req.method !== 'POST') return void json(405, { error: 'usa POST' }), true;
    const key = 'pkopt|' + clientIpOf(req);
    if (loginThrottled(key, envInt('DND5E_PASSKEY_MAX_ATTEMPTS', 10))) return void json(429, { error: 'Troppi tentativi: riprova tra 60 secondi' }), true;
    loginNoteAttempt(key);
    try {
      const body = await readJsonBody(req);
      const uname = String(body.username ?? '').trim().toLowerCase() || undefined;
      let allow: StoredPasskey[] | undefined;
      if (uname) {
        const acc = getAccount(uname);
        if (!acc) return void json(400, { error: 'Account non trovato: prima devi registrarti' }), true;
        allow = acc.passkeys ?? [];
        if (allow.length === 0) return void json(400, { error: 'Nessuna passkey su questo account: fai login con password e aggiungine una (tab Account → Sicurezza)' }), true;
      }
      const options = await authenticationOptionsFor(rpOfReq(req), allow);
      pkPrune();
      pkChallenges.set(options.challenge, { username: uname, at: Date.now() });
      return void json(200, { options }), true;
    } catch (e) { return void json(400, { error: (e as Error).message }), true; }
  }

  if (path === '/api/passkey/verify') {
    if (req.method !== 'POST') return void json(405, { error: 'usa POST' }), true;
    try {
      const body = await readJsonBody(req);
      const resp = body.response as { id: string; response?: { challenge?: string } };
      const challenge = String(resp?.response?.challenge ?? '');
      const ch = pkChallenges.get(challenge);
      if (!ch) return void json(400, { error: 'Challenge scaduto o sconosciuto: ricomincia il login con passkey' }), true;
      pkChallenges.delete(challenge);
      let owner: { username: string; passkey: StoredPasskey } | undefined;
      if (ch.username) {
        const pk = getAccountPasskey(ch.username, resp.id);
        if (pk) owner = { username: ch.username, passkey: pk };
      } else {
        owner = findPasskeyOwner(resp.id);
      }
      if (!owner) return void json(400, { error: 'Passkey non riconosciuta (non è registrata su questo server)' }), true;
      const key = 'pk:' + owner.username.toLowerCase();
      if (totpThrottled(key)) return void json(429, { error: 'Troppi tentativi: riprova tra 60 secondi' }), true;
      try {
        // la passkey conta come secondo fattore: niente TOTP in più
        const newCounter = await verifyAuthentication(resp as never, challenge, rpOfReq(req), toWebAuthnCredential(owner.passkey));
        updatePasskeyCounter(owner.username, resp.id, newCounter);
        const token = createSession(owner.username);
        noteLogin(owner.username);
        audit(owner.username, 'login-passkey', undefined, clientIpOf(req));
        return void json(200, { ok: true, username: owner.username }, token, false), true;
      } catch (e) {
        totpNoteAttempt(key);
        audit('ip:' + clientIpOf(req), 'login-passkey-failed', (e as Error).message, clientIpOf(req));
        return void json(400, { error: 'Asserzione passkey non verificata' }), true;
      }
    } catch (e) { return void json(400, { error: (e as Error).message }), true; }
  }

  if (req.method !== 'POST') return void json(405, { error: 'usa POST' }), true;

  try {
    const body = await readJsonBody(req);
    if (path === '/api/login-token') {
      const key = 'tok|' + clientIpOf(req);
      if (loginThrottled(key)) return void json(429, { error: 'Troppi tentativi: riprova tra 60 secondi' }), true;
      const acc = loginByRememberToken(String(body.token ?? ''));
      if (!acc) { loginNoteAttempt(key); audit('ip:' + clientIpOf(req), 'login-token-failed', undefined, clientIpOf(req)); return void json(401, { error: 'Token non valido o revocato' }), true; }
      const remember = body.remember === true;
      const token = createSession(acc.username);
      noteLogin(acc.username);
      audit(acc.username, 'login', 'via remember-token', clientIpOf(req));
      return void json(200, authJson(token, acc.username, remember ? createRememberToken(acc.username) : undefined), remember ? String(body.token) : token, remember), true;
    }
    if (path === '/api/register') {
      const key = 'reg|' + clientIpOf(req);
      if (loginThrottled(key, envInt('DND5E_REGISTER_MAX_ATTEMPTS', 5))) return void json(429, { error: 'Troppi tentativi: riprova tra 60 secondi' }), true;
      loginNoteAttempt(key);
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      if (registrationMode() === 'invite') {
        return void json(403, { error: 'Registrazione solo su invito: usa un link /invite?token=… creato dall\'admin' }), true;
      }
      if (registrationMode() === 'open') {
        // registrazione aperta: account creato subito (role user, a meno di DND5E_ADMIN_USER)
        const f = loadAccountsFile();
        const key = username.toLowerCase();
        if (!USERNAME_RE.test(username)) return void json(400, { error: 'Username non valido (3-24 caratteri: lettere, numeri, _ e -)' }), true;
        if (f.accounts[key]) return void json(400, { error: 'Username gia registrato' }), true;
        const acc: Account = {
          username, passwordHash: hashPassword(password), characters: {},
          createdAt: new Date().toISOString(),
          role: ADMIN_USER_ENV && key === ADMIN_USER_ENV ? 'admin' : 'user',
          savedP2PCampaigns: {}, totp: null, passkeys: [], loginCount: 0,
        };
        f.accounts[key] = acc;
        delete f.pending[key];
        saveAccountsFile(f);
        const remember = body.remember === true;
        const token = createSession(acc.username);
        noteLogin(acc.username);
        const remTok = remember ? createRememberToken(acc.username) : undefined;
        audit(acc.username, 'register', 'account creato (open)', clientIpOf(req));
        return void json(200, authJson(token, acc.username, remTok), remTok ?? token, remember), true;
      }
      requestAccount(username, password);
      audit(username, 'register-request', 'in attesa di approvazione', clientIpOf(req));
      return void json(200, { pending: true, message: 'Richiesta inviata: attendi l\'approvazione dell\'admin' }), true;
    }
    if (path === '/api/login') {
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      // anti-bruteforce: max N tentativi falliti/minuto per username+IP (DND5E_LOGIN_MAX_ATTEMPTS, default 10)
      const key = 'http|' + username.toLowerCase() + '|' + clientIpOf(req);
      if (loginThrottled(key)) return void json(429, { error: 'Troppi tentativi di login: riprova tra 60 secondi' }), true;
      try {
        const acc = loginAccount(username, password);
        loginAttempts.delete(key);
        if (accountTotpEnabled(acc.username)) {
          const code = String(body.code ?? '').trim();
          if (!code) return void json(401, { totpRequired: true, username: acc.username }), true;
          if (!verifyAccountTotp(acc.username, code)) { loginNoteAttempt(key); audit(username, 'login-failed', '2FA non valida', clientIpOf(req)); return void json(401, { error: 'Codice 2FA non valido' }), true; }
        }
        const remember = body.remember === true;
        const token = createSession(acc.username);
        noteLogin(acc.username);
        audit(acc.username, 'login', undefined, clientIpOf(req));
        // hardening: avvisa in audit se un admin entra con password ma senza 2FA (TOTP/passkey)
        if (accountRole(acc.username) === 'admin' && !acc.totp?.enabled && (acc.passkeys?.length ?? 0) === 0) {
          audit(acc.username, 'admin-login-no-2fa', 'admin loggato senza 2FA (attiva TOTP o una passkey)', clientIpOf(req));
        }
        const remTok = remember ? createRememberToken(acc.username) : undefined;
        return void json(200, authJson(token, acc.username, remTok), remTok ?? token, remember), true;
      } catch (e) {
        loginNoteAttempt(key);
        audit(username, 'login-failed', undefined, clientIpOf(req));
        return void json(400, { error: (e as Error).message }), true;
      }
    }
    return false;
  } catch (e) {
    return void json(400, { error: (e as Error).message }), true;
  }
}


/** pagina pubblica del link invito /invite?token=… (registrazione solo su invito) */
const INVITE_PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'invite.html');

/**
 * API del link di invito (pubblica come /login): 
 *   GET  /api/invite?token=…                    -> { valid, expiresAt? , reason? }
 *   POST /api/invite { token, username, password, remember? } -> crea l'account, marca l'invito usato (monouso)
 *                                                          e imposta il cookie di sessione (auto-login come /api/register aperta)
 */
async function handleInviteApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/api/invite') return false;
  const secure = isSecureReq(req);
  const json = (code: number, obj: unknown, token?: string, remember = false) => {
    if (token) setSessionCookie(res, token, remember, secure);
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET') {
    const chk = checkInvite(url.searchParams.get('token') ?? '');
    return void json(200, chk.ok ? { valid: true, expiresAt: chk.expiresAt } : { valid: false, reason: chk.reason }), true;
  }
  if (req.method !== 'POST') return void json(405, { error: 'usa POST' }), true;
  // anti-bruteforce sul token (256 bit, ma contiamo lo stesso per IP) e sui fallimenti
  const key = 'inv|' + clientIpOf(req);
  if (loginThrottled(key, envInt('DND5E_INVITE_MAX_ATTEMPTS', 10))) return void json(429, { error: 'Troppi tentativi: riprova tra 60 secondi' }), true;
  try {
    const body = await readJsonBody(req);
    const acc = createAccountFromInvite(String(body.token ?? ''), String(body.username ?? ''), String(body.password ?? ''));
    loginAttempts.delete(key);
    const remember = body.remember === true;
    const token = createSession(acc.username);
    noteLogin(acc.username);
    audit(acc.username, 'invite-used', 'account creato da invito', clientIpOf(req));
    const remTok = remember ? createRememberToken(acc.username) : undefined;
    return void json(200, authJson(token, acc.username, remTok), remTok ?? token, remember), true;
  } catch (e) {
    loginNoteAttempt(key);
    const msg = (e as Error).message;
    audit('ip:' + clientIpOf(req), 'invite-failed', msg, clientIpOf(req));
    const code = /scaduto|gia usato|non valido/.test(msg) ? 403 : 400;
    return void json(code, { error: msg }), true;
  }
}

/** pagina di login standalone servita al posto dell'app quando DND5E_REQUIRE_AUTH=true e senza sessione */
const LOGIN_PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'login.html');
function serveLoginPage(res: ServerResponse): void {
  try {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(LOGIN_PAGE));
  } catch {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<h1>5e Manager</h1><p>Login richiesto (DND5E_REQUIRE_AUTH). Pagina di login mancante: ricrea il build.</p>');
  }
}

function sendAdminState(ws: WebSocket): void {
  const accounts = Object.values(loadAccountsFile().accounts);
  const pending = listPending();
  const campaigns = listCampaignsDetailed();
  send(ws, {
    t: 'adminState',
    campaigns,
    accounts: accounts.map((a) => ({
      username: a.username,
      role: accountRole(a.username) ?? 'user',
      characters: Object.keys(a.characters).length,
      createdAt: a.createdAt,
      lastLoginAt: a.lastLoginAt,
      loginCount: a.loginCount ?? 0,
      totp: !!a.totp?.enabled,
      passkeys: a.passkeys?.length ?? 0,
      p2p: Object.keys(a.savedP2PCampaigns ?? {}).length,
    })),
    pending: pending.map((p) => ({ username: p.username, requestedAt: p.requestedAt })),
    invites: listInvites(),
    server: {
      startedAt: STARTED_AT.toISOString(),
      uptimeSec: Math.floor((Date.now() - STARTED_AT.getTime()) / 1000),
      campaigns: campaigns.length,
      accounts: accounts.length,
      pending: pending.length,
      characters: accounts.reduce((n, a) => n + Object.keys(a.characters).length, 0),
      p2pCampaigns: accounts.reduce((n, a) => n + Object.keys(a.savedP2PCampaigns ?? {}).length, 0),
      lan: lanAddresses(PORT),
      requireAuth: REQUIRE_AUTH,
      registration: registrationMode(),
    },
  });
}

async function handleMessage(conn: Conn, raw: string): Promise<void> {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  // DND5E_REQUIRE_AUTH: le operazioni dell'app richiedono la sessione (login o cookie)
  if (REQUIRE_AUTH && !conn.token && !AUTH_FREE_MSGS.has(msg.t)) {
    send(conn.ws, { t: 'error', message: 'Login richiesto su questo server (DND5E_REQUIRE_AUTH): accedi prima dal sito' });
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
    p2pRelay(conn, String(msg.hostId), { t: 'p2pJoinRequest', name: msg.name, password: msg.password, playerToken: msg.playerToken });
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
    p2pRelay(conn, host.id, { t: 'p2pJoinRequest', name: msg.name, password: msg.password, playerToken: msg.playerToken });
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
    try {
      const username = msg.username.trim();
      if (registrationMode() === 'invite') {
        send(conn.ws, { t: 'error', message: 'Registrazione solo su invito: chiedi all\'admin un link /invite?token=…' });
        return;
      }
      if (registrationMode() === 'open') {
        // registrazione APERTA: account creato subito e login immediato
        const f = loadAccountsFile();
        const key = username.toLowerCase();
        if (!USERNAME_RE.test(username)) throw new Error('Username non valido (3-24 caratteri: lettere, numeri, _ e -)');
        if (!msg.password || msg.password.length < 4) throw new Error('Password troppo corta (min 4 caratteri)');
        if (f.accounts[key]) throw new Error('Username gia registrato');
        const acc: Account = {
          username, passwordHash: hashPassword(msg.password), characters: {},
          createdAt: new Date().toISOString(),
          role: ADMIN_USER_ENV && key === ADMIN_USER_ENV ? 'admin' : 'user',
          savedP2PCampaigns: {}, totp: null, passkeys: [], loginCount: 0,
        };
        f.accounts[key] = acc;
        delete f.pending[key];
        saveAccountsFile(f);
        conn.token = createSession(acc.username);
        if (accountRole(acc.username) === 'admin') conn.admin = true;
        noteLogin(acc.username);
        sendAuth(conn.ws, conn.token, acc.username, false);
        send(conn.ws, { t: 'notice', message: 'Account "' + acc.username + '" creato (registrazione aperta): sei dentro.' });
        return;
      }
      // registrazione con APPROVAZIONE: crea solo una RICHIESTA, l'admin la approva dal pannello /admin
      requestAccount(username, msg.password);
      send(conn.ws, { t: 'notice', message: 'Richiesta di registrazione inviata per "' + username + '": attendi l\'approvazione dell\'admin.' });
    } catch (e) {
      send(conn.ws, { t: 'error', message: (e as Error).message });
    }
    return;
  }

  // login automatico con token "mantieni l'accesso" (persistito dal client in localStorage)
  if (msg.t === 'loginToken') {
    try {
      const acc = loginByRememberToken(String(msg.token ?? ''));
      if (!acc) {
        audit('ip:' + (connIp(conn) ?? '?'), 'login-token-failed', undefined, connIp(conn));
        send(conn.ws, { t: 'error', message: 'Token "mantieni l\'accesso" non valido o revocato: rifai il login' });
        return;
      }
      conn.token = createSession(acc.username);
      if (accountRole(acc.username) === 'admin') conn.admin = true;
      noteLogin(acc.username);
      audit(acc.username, 'login', 'via remember-token', connIp(conn));
      sendAuth(conn.ws, conn.token, acc.username, accountTotpEnabled(acc.username), msg.remember ? createRememberToken(acc.username) : undefined);
    } catch (e) {
      send(conn.ws, { t: 'error', message: (e as Error).message });
    }
    return;
  }

  if (msg.t === 'login') {
    // rienvio sessione: login con solo username e sessione (cookie) gia' valida -> auth di nuovo, niente password.
    // Usato dalla webapp servita dal server e dalla riconnessione automatica dopo un drop.
    if ((msg.password === undefined || msg.password === '') && conn.token) {
      const un = sessionUsername(conn.token);
      if (un && un.toLowerCase() === msg.username.trim().toLowerCase()) {
        sendAuth(conn.ws, conn.token, un, accountTotpEnabled(un));
        return;
      }
    }
    const key = 'ws|' + msg.username.trim().toLowerCase() + '|' + (connIp(conn) ?? '');
    if (loginThrottled(key)) {
      send(conn.ws, { t: 'error', message: 'Troppi tentativi di login: riprova tra 60 secondi' });
      return;
    }
    try {
      const acc = loginAccount(msg.username.trim(), msg.password ?? '');
      loginAttempts.delete(key);
      // 2FA attiva: la password è ok ma serve anche il codice TOTP (nessuna sessione ancora)
      if (accountTotpEnabled(acc.username)) {
        send(conn.ws, { t: 'totpRequired', username: acc.username });
        return;
      }
      conn.token = createSession(acc.username);
      // un account con ruolo admin entra direttamente nel pannello admin (senza DND5E_ADMIN_TOKEN)
      if (accountRole(acc.username) === 'admin') {
        conn.admin = true;
        // hardening: avvisa in audit se l'admin entra con password ma senza 2FA (TOTP/passkey)
        if (!acc.totp?.enabled && (acc.passkeys?.length ?? 0) === 0) {
          audit(acc.username, 'admin-login-no-2fa', 'admin loggato senza 2FA (attiva TOTP o una passkey)', connIp(conn));
        }
      }
      noteLogin(acc.username);
      audit(acc.username, 'login', undefined, connIp(conn));
      sendAuth(conn.ws, conn.token, acc.username, false, msg.remember ? createRememberToken(acc.username) : undefined);
    } catch (e) {
      loginNoteAttempt(key);
      audit(msg.username.trim(), 'login-failed', undefined, connIp(conn));
      send(conn.ws, { t: 'error', message: (e as Error).message });
    }
    return;
  }

  // login 2FA: password + codice TOTP (o codice di backup monouso), con throttle anti-bruteforce
  if (msg.t === 'loginTotp' || msg.t === 'loginTotpBackup') {
    const key = msg.username.trim().toLowerCase();
    if (totpThrottled(key)) {
      send(conn.ws, { t: 'error', message: 'Troppi tentativi 2FA: riprova tra 60 secondi' });
      return;
    }
    try {
      const acc = loginAccount(msg.username.trim(), msg.password);
      const ok = msg.t === 'loginTotp' ? verifyAccountTotp(acc.username, msg.code) : consumeBackupCode(acc.username, msg.backupCode);
      totpNoteAttempt(key);
      if (!ok) {
        send(conn.ws, { t: 'error', message: msg.t === 'loginTotp' ? 'Codice 2FA non valido (controlla che l\'ora del telefono sia automatica)' : 'Codice di backup non valido o già usato' });
        return;
      }
      conn.token = createSession(acc.username);
      if (accountRole(acc.username) === 'admin') conn.admin = true;
      noteLogin(acc.username);
      audit(acc.username, 'login', '2FA', connIp(conn));
      sendAuth(conn.ws, conn.token, acc.username, true, msg.remember ? createRememberToken(acc.username) : undefined);
    } catch (e) {
      send(conn.ws, { t: 'error', message: (e as Error).message });
    }
    return;
  }

  // gestione 2FA (richiede sessione login)
  if (msg.t === 'setupTotp' || msg.t === 'enableTotp' || msg.t === 'disableTotp') {
    const token = conn.token;
    const username = token ? sessionUsername(token) : undefined;
    if (!token || !username) {
      send(conn.ws, { t: 'error', message: 'Devi fare login prima di gestire la 2FA' });
      return;
    }
    try {
      if (msg.t === 'setupTotp') {
        const s = setupAccountTotp(username, '5e Manager');
        send(conn.ws, { t: 'totpSetup', secret: s.secret, otpauthUrl: s.otpauthUrl, backupCodes: s.backupCodes });
      } else if (msg.t === 'enableTotp') {
        if (!enableAccountTotp(username, msg.code)) {
          send(conn.ws, { t: 'error', message: 'Codice non valido (±30 s di tolleranza): controlla l\'ora del telefono' });
          return;
        }
        noteLogin(username);
        sendAuth(conn.ws, token, username, true);
        send(conn.ws, { t: 'notice', message: '🔐 2FA attivata' });
      } else {
        loginAccount(username, msg.password); // verifica password prima di disattivare
        disableAccountTotp(username);
        sendAuth(conn.ws, token, username, false);
        send(conn.ws, { t: 'notice', message: '2FA disattivata' });
      }
    } catch (e) {
      send(conn.ws, { t: 'error', message: (e as Error).message });
    }
    return;
  }

  // --- passkey WebAuthn (login passwordless; la registrazione richiede sessione) ---
  if (
    msg.t === 'passkeyRegisterStart' || msg.t === 'passkeyRegisterFinish' ||
    msg.t === 'passkeyLoginStart' || msg.t === 'passkeyLoginFinish' ||
    msg.t === 'passkeyList' || msg.t === 'passkeyRemove'
  ) {
    const rp = rpConfigFromHost(conn.rpHost);
    const token = conn.token;
    const username = token ? sessionUsername(token) : undefined;
    try {
      if (msg.t === 'passkeyRegisterStart') {
        if (!username) {
          send(conn.ws, { t: 'error', message: 'Devi fare login prima di registrare una passkey' });
          return;
        }
        const acc = getAccount(username);
        const options = await registrationOptionsFor(username, acc?.passkeys ?? [], rp);
        conn.passkeyChallenge = { kind: 'register', challenge: options.challenge, username };
        send(conn.ws, { t: 'passkeyRegisterOptions', options });
        return;
      }
      if (msg.t === 'passkeyRegisterFinish') {
        const ch = conn.passkeyChallenge;
        if (!username || !ch || ch.kind !== 'register' || ch.username !== username) {
          send(conn.ws, { t: 'error', message: 'Nessuna registrazione passkey in corso: ricomincia' });
          return;
        }
        const pk = await verifyRegistration(
          msg.response as never,
          ch.challenge,
          rp,
          'Passkey ' + new Date().toISOString().slice(0, 10),
        );
        addAccountPasskey(username, pk);
        conn.passkeyChallenge = undefined;
        send(conn.ws, { t: 'notice', message: '🔑 Passkey registrata (' + (pk.deviceType ?? 'authenticator') + ')' });
        send(conn.ws, { t: 'passkeyList', passkeys: listAccountPasskeys(username) });
        return;
      }
      if (msg.t === 'passkeyLoginStart') {
        const uname = msg.username?.trim();
        let allow: StoredPasskey[] | undefined;
        if (uname) {
          const acc = getAccount(uname);
          if (!acc) {
            send(conn.ws, { t: 'error', message: 'Account non trovato: prima devi registrarti' });
            return;
          }
          allow = acc.passkeys ?? [];
          if (allow.length === 0) {
            send(conn.ws, { t: 'error', message: 'Nessuna passkey su questo account: fai login con password e aggiungine una' });
            return;
          }
        }
        const options = await authenticationOptionsFor(rp, allow);
        conn.passkeyChallenge = { kind: 'login', challenge: options.challenge, username: uname?.toLowerCase() };
        send(conn.ws, { t: 'passkeyLoginOptions', options });
        return;
      }
      if (msg.t === 'passkeyLoginFinish') {
        const ch = conn.passkeyChallenge;
        if (!ch || ch.kind !== 'login') {
          send(conn.ws, { t: 'error', message: 'Nessun login passkey in corso: ricomincia' });
          return;
        }
        const resp = msg.response as { id: string };
        let owner: { username: string; passkey: StoredPasskey } | undefined;
        if (ch.username) {
          const pk = getAccountPasskey(ch.username, resp.id);
          if (pk) owner = { username: ch.username, passkey: pk };
        } else {
          owner = findPasskeyOwner(resp.id);
        }
        if (!owner) {
          send(conn.ws, { t: 'error', message: 'Passkey non riconosciuta (non è registrata su questo server)' });
          return;
        }
        const key = 'pk:' + owner.username.toLowerCase();
        if (totpThrottled(key)) {
          send(conn.ws, { t: 'error', message: 'Troppi tentativi: riprova tra 60 secondi' });
          return;
        }
        try {
          // la passkey conta come secondo fattore (possesso dell'autenticatore): niente TOTP in più
          const newCounter = await verifyAuthentication(resp as never, ch.challenge, rp, toWebAuthnCredential(owner.passkey));
          updatePasskeyCounter(owner.username, resp.id, newCounter);
          conn.passkeyChallenge = undefined;
          conn.token = createSession(owner.username);
          if (accountRole(owner.username) === 'admin') conn.admin = true;
          noteLogin(owner.username);
          audit(owner.username, 'login-passkey', undefined, connIp(conn));
          sendAuth(conn.ws, conn.token, owner.username, accountTotpEnabled(owner.username));
        } catch (e) {
          totpNoteAttempt(key);
          throw e;
        }
        return;
      }
      if (msg.t === 'passkeyList') {
        if (!username) {
          send(conn.ws, { t: 'error', message: 'Devi fare login prima' });
          return;
        }
        send(conn.ws, { t: 'passkeyList', passkeys: listAccountPasskeys(username) });
        return;
      }
      if (msg.t === 'passkeyRemove') {
        if (!username) {
          send(conn.ws, { t: 'error', message: 'Devi fare login prima' });
          return;
        }
        if (!removeAccountPasskey(username, msg.credentialId)) {
          send(conn.ws, { t: 'error', message: 'Passkey non trovata' });
          return;
        }
        send(conn.ws, { t: 'notice', message: 'Passkey rimossa' });
        send(conn.ws, { t: 'passkeyList', passkeys: listAccountPasskeys(username) });
        return;
      }
    } catch (e) {
      send(conn.ws, { t: 'error', message: (e as Error).message });
    }
    return;
  }

  if (msg.t === 'adminAuth') {
    // permessi admin via: token admin valido (DND5E_ADMIN_TOKEN) OPPURE sessione di un account con ruolo admin.
    // Senza token configurato vale solo su server fresco (nessun account) — mai per utenti non-admin loggati.
    // Se DND5E_ADMIN_ALLOWLIST è impostata, l'IP del client deve essere in lista (altrimenti niente adminAuth).
    if (!adminIpAllowed(connIp(conn), conn.xff)) {
      audit('ip:' + (connIp(conn) ?? '?'), 'adminauth-blocked-ip', 'IP non in DND5E_ADMIN_ALLOWLIST', connIp(conn));
      send(conn.ws, { t: 'error', message: 'IP non autorizzato per il pannello admin (DND5E_ADMIN_ALLOWLIST)' });
      return;
    }
    const uname = conn.token ? sessionUsername(conn.token) : undefined;
    const isAdminAccount = !!uname && accountRole(uname) === 'admin';
    const tokenOk = ADMIN_TOKEN !== '' && msg.token === ADMIN_TOKEN;
    const openLanFresh = ADMIN_TOKEN === '' && Object.keys(loadAccountsFile().accounts).length === 0;
    if (!tokenOk && !isAdminAccount && !openLanFresh) {
      audit(connActor(conn), 'adminauth-failed', undefined, connIp(conn));
      send(conn.ws, { t: 'error', message: 'Token admin non valido (o serve login come account admin)' });
      return;
    }
    conn.admin = true;
    sendAdminState(conn.ws);
    return;
  }

  if (msg.t === 'adminList' || msg.t === 'adminCreateCampaign' || msg.t === 'adminUpdateCampaign' || msg.t === 'adminDeleteCampaign' || msg.t === 'adminDeleteAccount' || msg.t === 'adminApproveAccount' || msg.t === 'adminRejectAccount' || msg.t === 'adminDeleteCharacter' || msg.t === 'adminSetRole' || msg.t === 'adminSetRegistration' || msg.t === 'adminResetPassword' || msg.t === 'adminDisableTotp' || msg.t === 'adminClearPasskeys' || msg.t === 'adminCampaignDetail' || msg.t === 'adminKickPlayer' || msg.t === 'adminBroadcast' || msg.t === 'adminCreateInvite' || msg.t === 'adminRevokeInvite' || msg.t === 'adminAudit' || msg.t === 'adminRevokeDevice' || msg.t === 'adminRevokeAllDevices' || msg.t === 'adminRevokeSessions') {
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
      if (msg.t === 'adminSetRegistration') setRegistrationMode(msg.mode === 'open' || msg.mode === 'invite' ? msg.mode : 'approval');
      if (msg.t === 'adminCreateInvite') {
        const inv = createInvite(msg.ttlHours);
        audit(connActor(conn), 'invite-create', `id=${inv.id} ttl=${msg.ttlHours ?? 'default'}h scade=${inv.expiresAt}`, connIp(conn));
        send(conn.ws, { t: 'inviteCreated', token: inv.token, id: inv.id, expiresAt: inv.expiresAt, url: '/invite?token=' + encodeURIComponent(inv.token) });
      }
      if (msg.t === 'adminRevokeInvite') {
        if (!revokeInvite(msg.inviteId)) throw new Error('Invito non trovato: ' + msg.inviteId);
      }
      if (msg.t === 'adminRevokeDevice') {
        if (!revokeRememberToken(msg.username, msg.tokenId)) throw new Error('Dispositivo non trovato: ' + msg.tokenId);
      }
      if (msg.t === 'adminRevokeAllDevices') revokeRememberTokens(msg.username);
      if (msg.t === 'adminRevokeSessions') revokeAllSessions(msg.username);
      if (msg.t === 'adminResetPassword') resetAccountPassword(msg.username, msg.password);
      if (msg.t === 'adminDisableTotp') adminDisableTotp(msg.username);
      if (msg.t === 'adminClearPasskeys') adminClearPasskeys(msg.username);
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
        dropRejoinToken(kickCampaignId, kickPlayerId);
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
    if (msg.t === 'adminAudit') {
      const limit = Number(msg.limit);
      send(conn.ws, { t: 'auditLog', entries: readAudit(Number.isFinite(limit) && limit > 0 ? Math.min(500, limit) : 100) });
      return;
    }
    // ogni azione admin risuscia finisce nell'audit log (actor + dettaglio, mai password/token).
    // adminCreateInvite e' gia' auditato sopra con l'id dell'invito: non duplicare.
    if (msg.t !== 'adminCreateInvite') {
      audit(connActor(conn), msg.t, adminDetail(msg as unknown as Record<string, unknown>), connIp(conn));
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
    const acc = getAccount(msg.username);
    send(conn.ws, {
      t: 'adminAccount',
      username: msg.username,
      characters: chars,
      devices: listDevices(msg.username),
      activeSessions: countActiveSessions(msg.username),
      sessionsRevokedAt: acc?.sessionsRevokedAt,
    });
    return;
  }

  if (msg.t === 'create') {
    const player: PlayerInfo = { id: randomUUID(), name: msg.name, role: 'master', online: true };
    const c = createCampaign(msg.campaignName, msg.password, player);
    campaigns.set(c.id, c);
    conn.campaignId = c.id;
    conn.playerId = player.id;
    conns.add(conn);
    if (msg.playerToken) rejoinTokens.set(msg.playerToken, { campaignId: c.id, playerId: player.id });
    send(conn.ws, { t: 'welcome', you: player, campaign: c });
    return;
  }

  if (msg.t === 'join') {
    const loaded = campaigns.get(msg.campaignId) ?? loadCampaign(msg.campaignId);
    if (!loaded) {
      send(conn.ws, { t: 'error', message: 'Campagna non trovata: ' + msg.campaignId });
      return;
    }
    const c = loaded;
    // campagna caricata da disco (es. server riavviato): tutti i giocatori salvati sono offline
    if (!campaigns.has(c.id)) {
      let dirty = false;
      for (const p of c.players) if (p.online !== false) { p.online = false; dirty = true; }
      if (dirty) saveCampaign(c);
    }
    campaigns.set(c.id, c);
    // rientro automatico dopo un drop: token valido -> stesso playerId (scheda compresa), niente password
    if (msg.playerToken) {
      const entry = rejoinTokens.get(msg.playerToken);
      const existing = entry && entry.campaignId === c.id ? c.players.find((p) => p.id === entry.playerId) : undefined;
      if (existing) {
        const key = rejoinKey(c.id, existing.id);
        const prev = offlineTimers.get(key);
        if (prev) { clearTimeout(prev); offlineTimers.delete(key); }
        setPlayerOnline(c, existing.id, true);
        if (msg.name) existing.name = msg.name;
        saveCampaign(c);
        conn.campaignId = c.id;
        conn.playerId = existing.id;
        conns.add(conn);
        send(conn.ws, { t: 'welcome', you: existing, campaign: c });
        broadcast(c);
        return;
      }
    }
    if (!checkPassword(c, msg.password)) {
      send(conn.ws, { t: 'error', message: 'Password sbagliata' });
      return;
    }
    // rientro come master: concesso se non c'è già un master collegato (la password della campagna protegge l'accesso)
    if (msg.role === 'master' && c.players.some((p) => p.role === 'master' && p.online !== false)) {
      send(conn.ws, { t: 'error', message: 'C\'è già un master collegato in questa campagna' });
      return;
    }
    const player: PlayerInfo = { id: randomUUID(), name: msg.name, role: msg.role === 'master' ? 'master' : 'player', online: true };
    addPlayer(c, player);
    conn.campaignId = c.id;
    conn.playerId = player.id;
    conns.add(conn);
    if (msg.playerToken) rejoinTokens.set(msg.playerToken, { campaignId: c.id, playerId: player.id });
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
      sendAuth(conn.ws, token, username, accountTotpEnabled(username));
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
    // uscita volontaria: il token di rientro non deve pi\u00f9 valere
    if (action.kind === 'leave') dropRejoinToken(next.id, conn.playerId);
    // kick: disconnetti subito il giocatore espulso e invalida il suo token di rientro
    if (action.kind === 'kickPlayer') {
      dropRejoinToken(next.id, action.playerId);
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
    applySecurityHeaders(req, res);
    if (infoHandler(req, res)) return;
    void handleAuthApi(req, res).then((handled) => { if (!handled) serveStatic(req, res); });
  });
  const wss = new WebSocketServer({
    server: http,
    maxPayload: 4 * 1024 * 1024,
    // anti cross-site WebSocket hijacking: se c'e' un header Origin deve combaciare con l'host (vedi wsOriginAllowed)
    verifyClient: (info, cb) => {
      if (wsOriginAllowed(info.req)) return cb(true);
      cb(false, 403, 'Origin non ammesso');
    },
  });

  wss.on('connection', (ws, req) => {
    const conn: Conn = { ws, id: 'c-' + Math.random().toString(36).slice(2, 10), rpHost: String(req.headers.host ?? ''), xff: String(req.headers['x-forwarded-for'] ?? '') };
    // con REQUIRE_AUTH il browser manda il cookie di sessione sull'upgrade WS: vale come login
    const tok = sessionTokenOf(req);
    if (tok) {
      conn.token = tok;
      const uname = sessionUsername(tok);
      if (uname) {
        if (accountRole(uname) === 'admin') conn.admin = true;
        // la webapp servita da questo server e' gia' loggata (cookie): le si manda subito 'auth' (libreria inclusa)
        sendAuth(ws, tok, uname, accountTotpEnabled(uname));
      }
    }
    conns.add(conn);
    ws.on('message', (data) => {
      handleMessage(conn, data.toString()).catch((e) => {
        send(ws, { t: 'error', message: 'Errore interno: ' + (e as Error).message });
      });
    });
    ws.on('close', () => {
      conns.delete(conn);
      if (p2pHosts.delete(conn.id)) broadcastP2PHosts();
      // avvisa gli host P2P annunciati che questo peer (relay) si è disconnesso: grace period lato host
      if (!p2pHosts.has(conn.id)) {
        const gone: ServerMessage = { t: 'p2pPeerGone', from: conn.id };
        for (const h of conns) if (p2pHosts.has(h.id)) send(h.ws, gone);
      }
      for (const [c, v] of p2pCodes) if (v.connId === conn.id) p2pCodes.delete(c);
      if (conn.campaignId && conn.playerId) {
        const cid = conn.campaignId;
        const pid = conn.playerId;
        // un'altra connessione dello stesso giocatore (es. seconda scheda) non lo fa andare offline
        const stillAttached = [...conns].some((x) => x.campaignId === cid && x.playerId === pid);
        const c = campaigns.get(cid);
        if (c && !stillAttached) {
          setPlayerOnline(c, pid, false);
          saveCampaign(c);
          campaigns.set(c.id, c);
          broadcast(c);
          scheduleOfflineRemoval(cid, pid);
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
  // In Docker networkInterfaces() vede solo l'IP del bridge (172.x): override da env.
  //  DND5E_LAN_IPS="ip1:3001,ip2:3001" (lista completa host:port) oppure DND5E_LAN_IP="192.168.1.36"
  const ipsEnv = (process.env.DND5E_LAN_IPS ?? '').trim();
  if (ipsEnv) return ipsEnv.split(',').map((x) => x.trim()).filter(Boolean);
  const ipEnv = (process.env.DND5E_LAN_IP ?? '').trim();
  if (ipEnv) return [`${ipEnv}:${port}`];
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
