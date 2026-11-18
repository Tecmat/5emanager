import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Character } from '@dnd5e/core';
import { DATA_DIR, ensureDataDir } from './campaign.js';

// dentro la data dir ma SENZA estensione .json, così listCampaigns() non la scambia per una campagna
export const ACCOUNTS_FILE = process.env.DND5E_ACCOUNTS_FILE ?? join(DATA_DIR, 'accounts.data');

export interface Account {
  username: string;
  /** libreria schede dell'account (salvate con l'azione saveCharacter) */
  characters: Record<string, Character>;
  createdAt: string;
  // TODO: aggiungere passwordHash e verificarla lato server (per ora solo lato client)
}

/** sessioni attive in memoria: token -> username (si perdono al riavvio del server) */
export const sessions = new Map<string, string>();

export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;

export function loadAccounts(): Record<string, Account> {
  try {
    if (existsSync(ACCOUNTS_FILE)) return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) as Record<string, Account>;
  } catch {
    /* file corroto: si riparte da un registro vuoto */
  }
  return {};
}

export function saveAccounts(accounts: Record<string, Account>): void {
  ensureDataDir();
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

export function registerAccount(username: string): Account {
  if (!USERNAME_RE.test(username)) {
    throw new Error('Username non valido (3-24 caratteri: lettere, numeri, _ e -)');
  }
  const accounts = loadAccounts();
  const key = username.toLowerCase();
  if (accounts[key]) throw new Error('Username già registrato');
  const acc: Account = { username, characters: {}, createdAt: new Date().toISOString() };
  accounts[key] = acc;
  saveAccounts(accounts);
  return acc;
}

export function getAccount(username: string): Account | undefined {
  return loadAccounts()[username.toLowerCase()];
}

export function accountCharacters(username: string): Character[] {
  return Object.values(getAccount(username)?.characters ?? {});
}

export function saveAccountCharacter(username: string, char: Character): void {
  const accounts = loadAccounts();
  const acc = accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato');
  acc.characters[char.id] = char;
  saveAccounts(accounts);
}

export function deleteAccountCharacter(username: string, characterId: string): void {
  const accounts = loadAccounts();
  const acc = accounts[username.toLowerCase()];
  if (!acc) throw new Error('Account non trovato');
  delete acc.characters[characterId];
  saveAccounts(accounts);
}

export function createSession(username: string): string {
  const token = randomUUID();
  sessions.set(token, username);
  return token;
}

export function sessionUsername(token: string): string | undefined {
  return sessions.get(token);
}
