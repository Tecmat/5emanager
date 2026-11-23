import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Character, SavedCampaignSnapshot } from '@dnd5e/core';
import { DATA_DIR, ensureDataDir, hashPassword } from './campaign.js';
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

export interface Account {
  username: string;
  /** hash sha256 della password (mai la password in chiaro); null = account legacy: la prima login la imposta */
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
}

export interface PendingRequest {
  username: string;
  passwordHash: string;
  requestedAt: string;
}

interface AccountsFile {
  v: 6;
  accounts: Record<string, Account>;
  pending: Record<string, PendingRequest>;
}

/** migrazione v1..v5 -> v6: aggiunge role, savedP2PCampaigns, totp e passkeys */
function migrateAccounts(raw: Record<string, unknown>): AccountsFile {
  let accounts: Record<string, Account>;
  let pending: Record<string, PendingRequest> = {};
  if (raw.v === 2 || raw.v === 3 || raw.v === 4 || raw.v === 5) {
    accounts = (raw.accounts ?? {}) as Record<string, Account>;
    pending = (raw.pending ?? {}) as Record<string, PendingRequest>;
  } else {
    accounts = raw as unknown as Record<string, Account>; // v1: file era un Record puro
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
    accounts[k] = a as Account;
  }
  return { v: 6, accounts, pending };
}

/** sessioni attive in memoria: token -> username (si perdono al riavvio del server) */
export const sessions = new Map<string, string>();

export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;

export function loadAccountsFile(): AccountsFile {
  try {
    if (existsSync(ACCOUNTS_FILE)) {
      const raw = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
      if (raw && raw.v === 6 && raw.accounts) return raw as AccountsFile;
      if (raw && typeof raw === 'object' && (raw.v === 2 || raw.v === 3 || raw.v === 4 || raw.v === 5 || !raw.v)) return migrateAccounts(raw);
    }
  } catch {
    /* file corroto: si riparte da un registro vuoto */
  }
  return { v: 6, accounts: {}, pending: {} };
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
  if (acc.passwordHash !== hashPassword(password)) throw new Error('Password errata');
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
  sessions.set(token, username);
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

/** true se non esiste ancora nessun account: il server mostra /setup per crearne uno */
export function setupRequired(): boolean {
  const f = loadAccountsFile();
  return Object.keys(f.accounts).length === 0 && Object.keys(f.pending).length === 0;
}

/** crea il primo account (sempre admin): consentito SOLO mentre non esistono account */
export function createFirstAdmin(username: string, password: string): Account {
  const f = loadAccountsFile();
  if (Object.keys(f.accounts).length > 0 || Object.keys(f.pending).length > 0) {
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

export function sessionUsername(token: string): string | undefined {
  return sessions.get(token);
}
