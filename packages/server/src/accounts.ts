import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Character, SavedCampaignSnapshot } from '@dnd5e/core';
import { DATA_DIR, ensureDataDir, hashPassword, isLegacyHash, verifyPassword } from './campaign.js';
import { generateBackupCodes, generateTotpSecret, hashBackupCode, otpauthUrl, verifyTotp } from './totp.js';

/** 2FA TOTP (app authenticator): il secret è salvato lato server (proteggi DND5E_DATA_DIR), i backup solo come hash */
export interface TotpState {
  secret: string;
  enabled: boolean;
  backupHashes: string[];
}

/** passkey WebAuthn salvata sull'account: publicKey in base64 (COSE), id in base64url */
export interface StoredPasskey {
  id: string;
  publicKeyB64: string;
  counter: number;
  transports?: string[];
  name: string;
  deviceType?: string;
  backedUp?: boolean;
  createdAt: string;
}

/** passkey esposta all'UI (senza chiave pubblica) */
export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  deviceType?: string;
  backedUp?: boolean;
}

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

// dentro la data dir ma SENZA estensione .json, così listCampaigns() non la scambia per una campagna
export const ACCOUNTS_FILE = process.env.DND5E_ACCOUNTS_FILE ?? join(DATA_DIR, 'accounts.data');

export type AccountRole = 'admin' | 'user';

/** se impostata (DND5E_ADMIN_USER), quell'account è admin a prescindere dal file (bootstrap del primo admin) */
export const ADMIN_USER = (process.env.DND5E_ADMIN_USER ?? '').toLowerCase();

/** token "mantieni l'accesso" (dispositivo): solo l'hash sha256 è salvato, con метadati per il pannello admin */
export interface RememberToken {
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface Account {
  username: string;
  /** hash scrypt della password (mai la password in chiaro); null = account legacy: la prima login la imposta */
  passwordHash: string | null;
  /** libreria schede dell'account (salvate con l'azione saveCharacter) */
  characters: Record<string, Character>;
  createdAt: string;
  role: AccountRole;
  /** campagne P2P salvate dall'host e sincronizzate su questo account (senza password) */
  savedP2PCampaigns: Record<string, SavedCampaignSnapshot>;
  /** 2FA TOTP; null = non configurata */
  totp: TotpState | null;
  /** passkey WebAuthn registrate (login passwordless) */
  passkeys: StoredPasskey[];
  /** statistiche per il pannello admin */
  lastLoginAt?: string;
  loginCount?: number;
  /** token "mantieni l'accesso" (max 10) come record con hash+metadati: login automatico senza password */
  rememberTokens?: RememberToken[];
  /** se impostato, le sessioni create prima di questa data sono invalide (adminRevokeSessions) */
  sessionsRevokedAt?: string;
}

export interface PendingRequest {
  username: string;
  passwordHash: string;
  requestedAt: string;
}

export type RegistrationMode = 'open' | 'approval' | 'invite';

/** invito di registrazione (modalita' "solo su invito"): il token vive solo come hash, e' monouso e a scadenza */
export interface InviteRecord {
  id: string;
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
  usedAt?: string;
}

interface AccountsFile {
  v: 9;
  accounts: Record<string, Account>;
  pending: Record<string, PendingRequest>;
  invites: Record<string, InviteRecord>;
  settings?: { registration?: RegistrationMode };
}

/** modalita' di registrazione del server: env DND5E_REGISTRATION > impostazione salvata > 'approval' (default).
 *  'invite' = solo su invito: /api/register e' chiuso, si registra solo da un link /invite?token=… creato dall'admin */
export function registrationMode(): RegistrationMode {
  const env = (process.env.DND5E_REGISTRATION ?? '').trim().toLowerCase();
  if (env === 'open' || env === 'approval' || env === 'invite') return env;
  const saved = loadAccountsFile().settings?.registration;
  return saved === 'open' || saved === 'invite' ? saved : 'approval';
}

/** l'admin cambia la modalita' di registrazione (persistente su disco) */
export function setRegistrationMode(mode: RegistrationMode): void {
  const f = loadAccountsFile();
  f.settings = { ...(f.settings ?? {}), registration: mode };
  saveAccountsFile(f);
}

/** normalizza rememberTokens (v8: string[] di hash -> v9: record con metadati) */
function normalizeRememberTokens(acc: Partial<Account>): void {
  const rt = acc.rememberTokens as unknown;
  if (!Array.isArray(rt)) { acc.rememberTokens = []; return; }
  if (rt.length > 0 && typeof rt[0] === 'string') {
    acc.rememberTokens = (rt as string[]).map((hash) => ({ hash, createdAt: acc.createdAt ?? new Date().toISOString() }));
  }
}

/** migrazione v1..v8 -> v9: aggiunge role, savedP2PCampaigns, totp, passkeys, invites e rememberTokens come record */
function migrateAccounts(raw: Record<string, unknown>): AccountsFile {
  let accounts: Record<string, Account>;
  let pending: Record<string, PendingRequest> = {};
  if (raw.v === 2 || raw.v === 3 || raw.v === 4 || raw.v === 5) {
    accounts = (raw.accounts ?? {}) as Record<string, Account>;
    pending = (raw.pending ?? {}) as Record<string, PendingRequest>;
  } else {
    accounts = (raw.accounts ?? raw) as unknown as Record<string, Account>; // v1: file era un Record puro
    if (raw.v !== undefined) pending = (raw.pending ?? {}) as Record<string, PendingRequest>;
  }
  const keys = Object.keys(accounts);
  const first = keys.sort((a, b) => String(accounts[a]?.createdAt ?? '').localeCompare(String(accounts[b]?.createdAt ?? '')))[0];
  for (const k of keys) {
    const a = accounts[k] as Partial<Account>;
    if (a.role !== 'admin' && a.role !== 'user') {
      a.role = ADMIN_USER ? (k.toLowerCase() === ADMIN_USER ? 'admin' : 'user') : (k === first ? 'admin' : 'user');
    }
    a.savedP2PCampaigns = a.savedP2PCampaigns ?? {};
    a.totp = a.totp ?? null;
    a.passkeys = a.passkeys ?? [];
    normalizeRememberTokens(a);
    accounts[k] = a as Account;
  }
  return { v: 9, accounts, pending, invites: (raw.invites ?? {}) as Record<string, InviteRecord>, settings: (raw.settings ?? {}) as AccountsFile['settings'] };
}

/** sessioni attive in memoria: token -> { username, createdAt } (si perdono al riavvio del server) */
export const sessions = new Map<string, { username: string; createdAt: number }>();

export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;

export function loadAccountsFile(): AccountsFile {
  try {
    if (existsSync(ACCOUNTS_FILE)) {
      const raw = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
      if (raw && (raw.v === 8 || raw.v === 9) && raw.accounts) {
        const f = migrateAccounts(raw); // normalizza anche v8 (rememberTokens record) e porta a v9
        return f;
      }
      if (raw && typeof raw === 'object' && (raw.v === 2 || raw.v === 3 || raw.v === 4 || raw.v === 5 || raw.v === 6 || raw.v === 7 || !raw.v)) return migrateAccounts(raw);
    }
  } catch {
    /* file corroto: si riparte da un registro vuoto */
  }
  return { v: 9, accounts: {}, pending: {}, invites: {}, settings: {} };
}

export function saveAccountsFile(f: AccountsFile): void {
  ensureDataDir();
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(f, null, 2));
}

export function loadAccounts(): Record<string, Account> {
  return loadAccountsFile().accounts;
}

export function saveAccounts(accounts: Record<string, Account>): void {
  const f = loadAccountsFile();
  f.accounts = accounts;
  saveAccountsFile(f);
}

// --- richieste di registrazione (approvate dall'admin) ---

export function requestAccount(username: string, password: string): PendingRequest {
  if (!USERNAME_RE.test(username)) {
    throw new Error('Username non valido (3-24 caratteri: lettere, numeri, _ e -)');
  }
  if (!password || password.length < 4) throw new Error('Password troppo corta (min 4 caratteri)');
  const f = loadAccountsFile();
  const key = username.toLowerCase();
  if (f.accounts[key]) throw new Error('Username già registrato');
  if (f.pending[key]) throw new Error('Richiesta già in attesa di approvazione');
  const req: PendingRequest = { username, passwordHash: hashPassword(password), requestedAt: new Date().toISOString() };
  f.pending[key] = req;
  saveAccountsFile(f);
  return req;
}

export function listPending(): PendingRequest[] {
  return Object.values(loadAccountsFile().pending);
}

/** l'admin approva: la richiesta diventa un account vero */
export function approveAccount(username: string): Account {
  const f = loadAccountsFile();
  const key = username.toLowerCase();
  const req = f.pending[key];
  if (!req) throw new Error('Nessuna richiesta in attesa per: ' + username);
  const acc: Account = {
    username: req.username,
    passwordHash: req.passwordHash,
    characters: {},
    createdAt: new Date().toISOString(),
    role: ADMIN_USER && key === ADMIN_USER ? 'admin' : 'user',
    savedP2PCampaigns: {},
    totp: null,
    passkeys: [],
  };
  f.accounts[key] = acc;
  delete f.pending[key];
  saveAccountsFile(f);
  return acc;
}

export function rejectAccount(username: string): void {
  const f = loadAccountsFile();
  const key = username.toLowerCase();
  if (!f.pending[key]) throw new Error('Nessuna richiesta in attesa per: ' + username);
  delete f.pending[key];
  saveAccountsFile(f);
}

/** login lato server: solo account APPROVATI; account legacy senza hash -> la prima login imposta la password */
export function loginAccount(username: string, password: string): Account {
  const f = loadAccountsFile();
  const key = username.toLowerCase();
  const acc = f.accounts[key];
  if (!acc) {
    if (f.pending[key]) throw new Error('Richiesta in attesa di approvazione dall\'admin');
    throw new Error('Account non trovato: prima devi registrarti');
  }
  if (acc.passwordHash === null || acc.passwordHash === undefined) {
    acc.passwordHash = hashPassword(password);
    f.accounts[key] = acc;
    saveAccountsFile(f);
    return acc;
  }
  if (!verifyPassword(password, acc.passwordHash)) throw new Error('Password errata');
  // upgrade trasparente: vecchio hash sha256 (senza sale) -> scrypt con sale
  if (isLegacyHash(acc.passwordHash)) {
    acc.passwordHash = hashPassword(password);
    f.accounts[key] = acc;
    saveAccountsFile(f);
  }
  return acc;
}

export function getAccount(username: string): Account | undefined {
  return loadAccountsFile().accounts[username.toLowerCase()];
}

/** ruolo effettivo (DND5E_ADMIN_USER ha sempre ruolo admin) */
export function accountRole(username: string): AccountRole | undefined {
  const acc = getAccount(username);
  if (!acc) return undefined;
  if (ADMIN_USER && username.toLowerCase() === ADMIN_USER) return 'admin';
  return acc.role ?? 'user';
}

export function countAdmins(): number {
  return Object.values(loadAccountsFile().accounts).filter((a) => accountRole(a.username) === 'admin').length;
}

/** l'admin promuove/declassa un utente (l'ultimo admin non si può declassare se non c'è DND5E_ADMIN_USER) */
export function setAccountRole(username: string, role: AccountRole): void {
  const f = loadAccountsFile();
  const key = username.toLowerCase();
  const acc = f.accounts[key];
  if (!acc) throw new Error('Account non trovato: ' + username);
  if (role === 'user' && accountRole(username) === 'admin' && countAdmins() <= 1 && !ADMIN_USER) {
    throw new Error("Non puoi rimuovere l'ultimo admin (imposta DND5E_ADMIN_USER o promuovi prima un altro utente)");
  }
  acc.role = role;
  f.accounts[key] = acc;
  saveAccountsFile(f);
}

/** l'admin reimposta la password di un utente */
export function resetAccountPassword(username: string, newPassword: string): void {
  if (!newPassword || newPassword.length < 4) throw new Error('Password troppo corta (min 4 caratteri)');
  const f = loadAccountsFile();
  const key = username.toLowerCase();
  const acc = f.accounts[key];
  if (!acc) throw new Error('Account non trovato: ' + username);
  acc.passwordHash = hashPassword(newPassword);
  f.accounts[key] = acc;
  saveAccountsFile(f);
}

/** campagne P2P salvate sincronizzate sull'account (upsert per id, cap 20) */
export function saveAccountP2PCampaign(username: string, saved: SavedCampaignSnapshot): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato');
  acc.savedP2PCampaigns = acc.savedP2PCampaigns ?? {};
  acc.savedP2PCampaigns[saved.id] = saved;
  const list = Object.values(acc.savedP2PCampaigns).sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? '')).slice(0, 20);
  acc.savedP2PCampaigns = {};
  for (const s of list) acc.savedP2PCampaigns[s.id] = s;
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
}

export function deleteAccountP2PCampaign(username: string, id: string): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato');
  if (acc.savedP2PCampaigns?.[id]) {
    delete acc.savedP2PCampaigns[id];
    saveAccountsFile(f);
  }
}

export function accountSavedP2PCampaigns(username: string): SavedCampaignSnapshot[] {
  return Object.values(getAccount(username)?.savedP2PCampaigns ?? {}).sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
}

// --- 2FA TOTP ---

export function accountTotpEnabled(username: string): boolean {
  return !!getAccount(username)?.totp?.enabled;
}

/** genera (o rigenera) il secret TOTP + codici di backup: l'UI mostra QR/secret/codici UNA volta sola */
export function setupAccountTotp(username: string, issuer: string): TotpSetup {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato');
  const secret = generateTotpSecret();
  const backupCodes = generateBackupCodes(8);
  acc.totp = { secret, enabled: false, backupHashes: backupCodes.map(hashBackupCode) };
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
  return { secret, otpauthUrl: otpauthUrl(secret, issuer, acc.username), backupCodes };
}

/** attiva la 2FA solo se il codice TOTP è valido (±1 step) */
export function enableAccountTotp(username: string, code: string): boolean {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc?.totp?.secret) throw new Error('Nessun secret TOTP: fai prima setupTotp');
  if (!verifyTotp(acc.totp.secret, code)) return false;
  acc.totp.enabled = true;
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
  return true;
}

export function disableAccountTotp(username: string): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato');
  acc.totp = null;
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
}

export function verifyAccountTotp(username: string, code: string): boolean {
  const acc = getAccount(username);
  if (!acc?.totp?.enabled) return false;
  return verifyTotp(acc.totp.secret, code);
}

/** un codice di backup vale una volta sola */
export function consumeBackupCode(username: string, code: string): boolean {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc?.totp?.enabled) return false;
  const norm = hashBackupCode(code);
  const i = acc.totp.backupHashes.indexOf(norm);
  if (i < 0) return false;
  acc.totp.backupHashes.splice(i, 1);
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
  return true;
}

// --- passkey WebAuthn ---

export function listAccountPasskeys(username: string): PasskeyInfo[] {
  const acc = getAccount(username);
  return (acc?.passkeys ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    deviceType: p.deviceType,
    backedUp: p.backedUp,
  }));
}

export function getAccountPasskey(username: string, credentialId: string): StoredPasskey | undefined {
  return getAccount(username)?.passkeys?.find((p) => p.id === credentialId);
}

/** aggiunge una passkey all'account (cap 10 per account) */
export function addAccountPasskey(username: string, pk: StoredPasskey): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato');
  acc.passkeys = acc.passkeys ?? [];
  acc.passkeys = acc.passkeys.filter((p) => p.id !== pk.id);
  acc.passkeys.unshift(pk);
  acc.passkeys = acc.passkeys.slice(0, 10);
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
}

export function removeAccountPasskey(username: string, credentialId: string): boolean {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc?.passkeys) return false;
  const n = acc.passkeys.length;
  acc.passkeys = acc.passkeys.filter((p) => p.id !== credentialId);
  if (acc.passkeys.length === n) return false;
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
  return true;
}

/** trova a quale account appartiene una credenziale (login discoverable senza username) */
export function findPasskeyOwner(credentialId: string): { username: string; passkey: StoredPasskey } | undefined {
  for (const acc of Object.values(loadAccountsFile().accounts)) {
    const passkey = (acc.passkeys ?? []).find((p) => p.id === credentialId);
    if (passkey) return { username: acc.username, passkey };
  }
  return undefined;
}

/** aggiorna il counter anti-replay dopo un login passkey riuscito */
export function updatePasskeyCounter(username: string, credentialId: string, counter: number): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  const pk = acc?.passkeys?.find((p) => p.id === credentialId);
  if (!acc || !pk) return;
  pk.counter = counter;
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
}

export function accountCharacters(username: string): Character[] {
  return Object.values(getAccount(username)?.characters ?? {});
}

export function saveAccountCharacter(username: string, char: Character): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato');
  acc.characters[char.id] = char;
  saveAccountsFile(f);
}

export function deleteAccountCharacter(username: string, characterId: string): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato');
  delete acc.characters[characterId];
  saveAccountsFile(f);
}

export function deleteAccount(username: string): void {
  const f = loadAccountsFile();
  const key = username.toLowerCase();
  if (!f.accounts[key]) throw new Error('Account non trovato');
  delete f.accounts[key];
  delete f.pending[key];
  saveAccountsFile(f);
}

export function createSession(username: string): string {
  const token = randomUUID();
  sessions.set(token, { username, createdAt: Date.now() });
  return token;
}

/** registra un login riuscito (statistiche pannello admin) */
export function noteLogin(username: string): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) return;
  acc.loginCount = (acc.loginCount ?? 0) + 1;
  acc.lastLoginAt = new Date().toISOString();
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
}

// --- setup iniziale (primo admin) ---

/** true se non esiste ancora nessun account: il server mostra /setup per crearne uno.
 *  NB: le richieste di registrazione in attesa (pending) NON bloccano il setup: sono solo
 *  richieste, non account — bloccare su pending permetterebbe a chiunque (su server pubblico
 *  prima del primo avvio) di occupare il setup con una finta registrazione e impedire al owner
 *  di creare l'admin. */
export function setupRequired(): boolean {
  return Object.keys(loadAccountsFile().accounts).length === 0;
}

/** crea il primo account (sempre admin): consentito SOLO mentre non esistono account */
export function createFirstAdmin(username: string, password: string): Account {
  const f = loadAccountsFile();
  if (Object.keys(f.accounts).length > 0) {
    throw new Error('Setup gia completato: esistono gia account (usa /admin per gestirli)');
  }
  const uname = username.trim();
  if (!USERNAME_RE.test(uname)) throw new Error('Username non valido (3-24 caratteri: lettere, numeri, _ e -)');
  if (!password || password.length < 4) throw new Error('Password troppo corta (min 4 caratteri)');
  const acc: Account = {
    username: uname,
    passwordHash: hashPassword(password),
    characters: {},
    createdAt: new Date().toISOString(),
    role: 'admin',
    savedP2PCampaigns: {},
    totp: null,
    passkeys: [],
    loginCount: 0,
  };
  f.accounts[uname.toLowerCase()] = acc;
  saveAccountsFile(f);
  return acc;
}

// --- azioni admin sugli account (pannello /admin) ---

/** l'admin fuerza la disattivazione della 2FA di un utente */
export function adminDisableTotp(username: string): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato: ' + username);
  acc.totp = null;
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
}

/** l'admin rimuove tutte le passkey di un utente */
export function adminClearPasskeys(username: string): number {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato: ' + username);
  const n = acc.passkeys?.length ?? 0;
  acc.passkeys = [];
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
  return n;
}

/** risolve la sessione; se l'admin ha revocato le sessioni dell'account (sessionsRevokedAt) quelle vecchie muoiono */
export function sessionUsername(token: string): string | undefined {
  const s = sessions.get(token);
  if (!s) return undefined;
  const acc = getAccount(s.username);
  if (acc?.sessionsRevokedAt && s.createdAt < Date.parse(acc.sessionsRevokedAt)) {
    sessions.delete(token);
    return undefined;
  }
  return s.username;
}

/** numero di sessioni attive in memoria per un account (statistica pannello admin) */
export function countActiveSessions(username: string): number {
  const key = username.toLowerCase();
  let n = 0;
  for (const s of sessions.values()) if (s.username.toLowerCase() === key && sessionUsernameSafe(s)) n++;
  return n;
}
function sessionUsernameSafe(s: { username: string; createdAt: number }): boolean {
  const acc = getAccount(s.username);
  return !acc?.sessionsRevokedAt || s.createdAt >= Date.parse(acc.sessionsRevokedAt);
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}

function hashToken(t: string): string {
  return createHash('sha256').update('5e-remember-' + t).digest('hex');
}

/** crea un token "mantieni l'accesso" persistente per l'account (solo hash salvato, max 10) */
export function createRememberToken(username: string): string {
  const token = randomUUID() + randomUUID();
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato: ' + username);
  const list = [...(acc.rememberTokens ?? []), { hash: hashToken(token), createdAt: new Date().toISOString() }].slice(-10);
  acc.rememberTokens = list;
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
  return token;
}

/** login automatico con token "mantieni l'accesso": ritorna l'account se il token e' valido (aggiorna lastUsedAt) */
export function loginByRememberToken(token: string): Account | undefined {
  const h = hashToken(token);
  const f = loadAccountsFile();
  for (const acc of Object.values(f.accounts)) {
    const rt = (acc.rememberTokens ?? []).find((t) => t.hash === h);
    if (rt) {
      rt.lastUsedAt = new Date().toISOString();
      f.accounts[acc.username.toLowerCase()] = acc;
      saveAccountsFile(f);
      return acc;
    }
  }
  return undefined;
}

/** revoca tutti i token "mantieni l'accesso" dell'account (es. al cambio password o adminRevokeAllDevices) */
export function revokeRememberTokens(username: string): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) return;
  acc.rememberTokens = [];
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
}

/** revoca un singolo dispositivo (tokenId = prime 10 cifre dell'hash) */
export function revokeRememberToken(username: string, tokenId: string): boolean {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc?.rememberTokens) return false;
  const n = acc.rememberTokens.length;
  acc.rememberTokens = acc.rememberTokens.filter((t) => t.hash.slice(0, 10) !== tokenId);
  const removed = acc.rememberTokens.length !== n;
  if (removed) {
    f.accounts[username.toLowerCase()] = acc;
    saveAccountsFile(f);
  }
  return removed;
}

/** invalida TUTTE le sessioni in-memory dell'account (da adminRevokeSessions): le sessioni create prima di ora muoiono */
export function revokeAllSessions(username: string): void {
  const f = loadAccountsFile();
  const acc = f.accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato: ' + username);
  acc.sessionsRevokedAt = new Date().toISOString();
  f.accounts[username.toLowerCase()] = acc;
  saveAccountsFile(f);
}

/** dispositivi "mantieni l'accesso" dell'account per il pannello admin (id = prime 10 cifre dell'hash, mai il token) */
export function listDevices(username: string): { id: string; createdAt: string; lastUsedAt?: string }[] {
  const acc = getAccount(username);
  return (acc?.rememberTokens ?? [])
    .map((t) => ({ id: t.hash.slice(0, 10), createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// --- inviti di registrazione (modalita' "solo su invito": link /invite?token=… monouso e a scadenza) ---

/** TTL di default degli inviti (ore); DND5E_INVITE_TTL_HOURS lo sovrascrive; clamp 1..168 (7 giorni) */
const INVITE_DEFAULT_TTL_H = (() => {
  const n = Number(process.env.DND5E_INVITE_TTL_HOURS ?? 24);
  return Number.isFinite(n) && n > 0 ? n : 24;
})();

function hashInviteToken(t: string): string {
  return createHash('sha256').update('5e-invite-' + t).digest('hex');
}

/** elimina gli inviti scaduti (ormai inutilizzabili) */
function pruneInvites(f: AccountsFile): void {
  const now = Date.now();
  for (const [k, rec] of Object.entries(f.invites)) {
    if (Date.parse(rec.expiresAt) <= now) delete f.invites[k];
  }
}

/** crea un invito: token random a 256 bit (mai salvato in chiaro, solo hash), id = prime 10 cifre dell'hash */
export function createInvite(ttlHours?: number): { token: string; id: string; expiresAt: string } {
  const ttl = Math.min(168, Math.max(1, Math.round(Number(ttlHours ?? INVITE_DEFAULT_TTL_H) || INVITE_DEFAULT_TTL_H)));
  const token = randomBytes(32).toString('base64url');
  const key = hashInviteToken(token);
  const f = loadAccountsFile();
  pruneInvites(f);
  const now = Date.now();
  const rec: InviteRecord = { id: key.slice(0, 10), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttl * 3600_000).toISOString() };
  f.invites[key] = rec;
  saveAccountsFile(f);
  return { token, id: rec.id, expiresAt: rec.expiresAt };
}

export type InviteCheck = { ok: true; id: string; expiresAt: string } | { ok: false; reason: 'invalid' | 'used' | 'expired' };

/** verifica un token di invito SENZA consumarlo */
export function checkInvite(token: string): InviteCheck {
  const key = hashInviteToken(String(token ?? '').trim());
  const rec = loadAccountsFile().invites[key];
  if (!rec) return { ok: false, reason: 'invalid' };
  if (rec.usedBy) return { ok: false, reason: 'used' };
  if (Date.parse(rec.expiresAt) <= Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, id: rec.id, expiresAt: rec.expiresAt };
}

/** crea l'account da un invito VALIDO e lo marca usato (monouso): un secondo uso fallisce */
export function createAccountFromInvite(token: string, username: string, password: string): Account {
  const chk = checkInvite(token);
  if (!chk.ok) {
    throw new Error(chk.reason === 'expired' ? 'Invito scaduto' : chk.reason === 'used' ? 'Invito gia usato (monouso)' : 'Invito non valido');
  }
  const uname = username.trim();
  if (!USERNAME_RE.test(uname)) throw new Error('Username non valido (3-24 caratteri: lettere, numeri, _ e -)');
  if (!password || password.length < 4) throw new Error('Password troppo corta (min 4 caratteri)');
  const f = loadAccountsFile();
  const key = uname.toLowerCase();
  if (f.accounts[key]) throw new Error('Username gia registrato');
  const acc: Account = {
    username: uname,
    passwordHash: hashPassword(password),
    characters: {},
    createdAt: new Date().toISOString(),
    role: ADMIN_USER && key === ADMIN_USER ? 'admin' : 'user',
    savedP2PCampaigns: {},
    totp: null,
    passkeys: [],
    loginCount: 0,
  };
  f.accounts[key] = acc;
  delete f.pending[key]; // l'invito vale al posto della richiesta di approvazione
  const ikey = hashInviteToken(String(token).trim());
  f.invites[ikey].usedBy = uname;
  f.invites[ikey].usedAt = new Date().toISOString();
  saveAccountsFile(f);
  return acc;
}

/** lista inviti per il pannello admin (id mascherato, mai il token in chiaro) */
export function listInvites(): InviteRecord[] {
  const f = loadAccountsFile();
  pruneInvites(f);
  return Object.values(f.invites).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** revoca un invito prima della scadenza (id = prime 10 cifre dell'hash) */
export function revokeInvite(id: string): boolean {
  const f = loadAccountsFile();
  const key = Object.keys(f.invites).find((k) => f.invites[k].id === id);
  if (!key) return false;
  delete f.invites[key];
  saveAccountsFile(f);
  return true;
}
