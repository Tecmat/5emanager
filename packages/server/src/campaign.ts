import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HOUSE_RULES, DEFAULT_STATS, migrateCampaign, type Character, type SrdData } from '@dnd5e/core';
import type { Campaign, PlayerInfo } from './protocol.js';

/**
 * Hash password: scrypt con sale casuale per utente (formato `scrypt$N$r$p$sale$hash`),
 * resistente al brute-force offline sul file dei dati. Vecchi hash sha256 (senza sale)
 * restano verificabili via verifyPassword e vengono aggiornati al primo login riuscito.
 */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync('5e-' + pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** true se l'hash salvato e' nel vecchio formato sha256 (da aggiornare al login) */
export function isLegacyHash(stored: string): boolean {
  return !stored.startsWith('scrypt$');
}

/** verifica una password contro l'hash salvato (scrypt nuovo o sha256 legacy), confronto in tempo costante */
export function verifyPassword(pw: string, stored: string): boolean {
  if (stored.startsWith('scrypt$')) {
    try {
      const [, n, r, p, saltB64, hashB64] = stored.split('$');
      const salt = Buffer.from(saltB64, 'base64');
      const expected = Buffer.from(hashB64, 'base64');
      const hash = scryptSync('5e-' + pw, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
      return hash.length === expected.length && timingSafeEqual(hash, expected);
    } catch {
      return false;
    }
  }
  const legacy = createHash('sha256').update('5e-' + pw).digest();
  const exp = Buffer.from(stored, 'hex');
  return legacy.length === exp.length && timingSafeEqual(legacy, exp);
}

export const DATA_DIR = process.env.DND5E_DATA_DIR ?? join(process.cwd(), 'data', 'campaigns');

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function campaignPath(id: string): string {
  return join(DATA_DIR, `${id}.json`);
}

export function saveCampaign(c: Campaign): void {
  ensureDataDir();
  c.updatedAt = new Date().toISOString();
  writeFileSync(campaignPath(c.id), JSON.stringify(c, null, 2));
}

export function loadCampaign(id: string): Campaign | null {
  const p = campaignPath(id);
  if (!existsSync(p)) return null;
  return migrateCampaign(JSON.parse(readFileSync(p, 'utf8')) as Campaign);
}

export function listCampaigns(): { id: string; name: string; players: number }[] {
  ensureDataDir();
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const c = loadCampaign(f.replace(/\.json$/, ''));
        return c && typeof c.id === 'string' ? { id: c.id, name: c.name, players: c.players.length } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { id: string; name: string; players: number }[];
}

export interface CampaignSummary {
  id: string;
  name: string;
  players: number;
  inCombat: boolean;
  /** numero di personaggi caricati nella campagna (statistica pannello admin) */
  characters: number;
  createdAt: string;
  updatedAt: string;
}

export function listCampaignsDetailed(): CampaignSummary[] {
  ensureDataDir();
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const c = loadCampaign(f.replace(/\.json$/, ''));
        return c && typeof c.id === 'string'
          ? { id: c.id, name: c.name, players: c.players.length, inCombat: !!c.combat, characters: Object.keys(c.characters ?? {}).length, createdAt: c.createdAt, updatedAt: c.updatedAt }
          : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CampaignSummary[];
}

export function deleteCampaign(id: string): boolean {
  const p = campaignPath(id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export function createCampaign(name: string, password: string, master: PlayerInfo): Campaign {
  const c: Campaign = {
    id: randomUUID().slice(0, 8),
    name,
    passwordHash: hashPassword(password),
    houseRules: { ...DEFAULT_HOUSE_RULES },
    custom: {},
    players: [master],
    characters: {},
    combat: null,
    groupInventory: [],
    groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: '',
    chat: [],
    stats: { ...DEFAULT_STATS },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveCampaign(c);
  return c;
}

/** campagna creata dall'admin: senza master collegato, il primo che entra come master (con password) lo diventa */
export function createCampaignAdmin(name: string, password: string): Campaign {
  const c: Campaign = {
    id: randomUUID().slice(0, 8),
    name,
    passwordHash: hashPassword(password),
    houseRules: { ...DEFAULT_HOUSE_RULES },
    custom: {},
    players: [],
    characters: {},
    combat: null,
    groupInventory: [],
    groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: '',
    chat: [],
    stats: { ...DEFAULT_STATS },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveCampaign(c);
  return c;
}

/** rinomina e/o cambia password di una campagna (admin) */
export function updateCampaign(id: string, patch: { name?: string; password?: string }): Campaign {
  const c = loadCampaign(id);
  if (!c) throw new Error('Campagna non trovata: ' + id);
  if (patch.name !== undefined && patch.name.trim()) c.name = patch.name.trim();
  if (patch.password !== undefined && patch.password.length > 0) c.passwordHash = hashPassword(patch.password);
  saveCampaign(c);
  return c;
}

export function checkPassword(c: Campaign, password: string): boolean {
  return verifyPassword(password, c.passwordHash);
}

export function addPlayer(c: Campaign, p: PlayerInfo): Campaign {
  c.players = [...c.players.filter((x) => x.id !== p.id), p];
  saveCampaign(c);
  return c;
}

export function removePlayer(c: Campaign, id: string): Campaign {
  c.players = c.players.filter((x) => x.id !== id);
  saveCampaign(c);
  return c;
}

export function setCharacter(c: Campaign, playerId: string, character: Character): Campaign {
  c.characters[playerId] = character;
  const p = c.players.find((x) => x.id === playerId);
  if (p) p.characterId = character.id;
  saveCampaign(c);
  return c;
}

export function addCustom(c: Campaign, data: Partial<SrdData>): Campaign {
  const merge = (key: keyof SrdData) => {
    if (Array.isArray(data[key])) {
      const cur = (c.custom[key] ?? []) as unknown[];
      c.custom[key] = [...cur, ...(data[key] as unknown[])] as never;
    }
  };
  (['classes', 'subclasses', 'races', 'spells', 'weapons', 'armors', 'feats', 'enemies'] as (keyof SrdData)[]).forEach(merge);
  saveCampaign(c);
  return c;
}
