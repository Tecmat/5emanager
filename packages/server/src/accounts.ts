import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Character } from '@dnd5e/core';
import { DATA_DIR, ensureDataDir, hashPassword } from './campaign.js';

// dentro la data dir ma SENZA estensione .json, così listCampaigns() non la scambia per una campagna
export const ACCOUNTS_FILE = process.env.DND5E_ACCOUNTS_FILE ?? join(DATA_DIR, 'accounts.data');

export interface Account {
  username: string;
  /** hash sha256 della password (mai la password in chiaro); null = account legacy: la prima login la imposta */
  passwordHash: string | null;
  /** libreria schede dell'account (salvate con l'azione saveCharacter) */
  characters: Record<string, Character>;
  createdAt: string;
}

export interface PendingRequest {
  username: string;
  passwordHash: string;
  requestedAt: string;
}

interface AccountsFile {
  v: 2;
  accounts: Record<string, Account>;
  pending: Record<string, PendingRequest>;
}

/** sessioni attive in memoria: token -> username (si perdono al riavvio del server) */
export const sessions = new Map<string, string>();

export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;

export function loadAccountsFile(): AccountsFile {
  try {
    if (existsSync(ACCOUNTS_FILE)) {
      const raw = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
      if (raw && raw.v === 2 && raw.accounts) return raw as AccountsFile;
      // migrazione v1: file era un semplice Record<username, Account>
      if (raw && typeof raw === 'object' && !raw.v) {
        return { v: 2, accounts: raw as Record<string, Account>, pending: {} };
      }
    }
  } catch {
    /* file corroto: si riparte da un registro vuoto */
  }
  return { v: 2, accounts: {}, pending: {} };
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
  const acc: Account = { username: req.username, passwordHash: req.passwordHash, characters: {}, createdAt: new Date().toISOString() };
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

export function sessionUsername(token: string): string | undefined {
  return sessions.get(token);
}
