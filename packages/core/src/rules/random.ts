import type { Currency, ItemRarity } from '../types.js';

/** tabelle per il generatore casuale del master (nomi, incontri, tesori) — dati in data-srd/data/random.json */
export interface RandomEncounterEntry {
  name: string;
  enemies: { enemyId: string; count: number }[];
  xp: number;
}

export interface RandomTreasureItem {
  name: string;
  quantity?: number;
  valueGp?: number;
  rarity?: ItemRarity;
  magic?: boolean;
}

export interface RandomTreasureEntry {
  text: string;
  currency?: Partial<Currency>;
  items?: RandomTreasureItem[];
}

export interface RandomTier {
  tier: string;
  minLevel: number;
  maxLevel: number;
  encounters: RandomEncounterEntry[];
  treasure: RandomTreasureEntry[];
}

export interface RandomData {
  names: { first: string[]; last: string[]; epithet: string[] };
  tiers: RandomTier[];
}

export type Rng = () => number;

const defaultRng: Rng = () => Math.random();

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** nome fantasy casuale (nome + cognome + eventualmente epiteto) */
export function randomName(data: RandomData, rng: Rng = defaultRng): string {
  const first = pick(data.names.first, rng);
  const last = pick(data.names.last, rng);
  const ep = rng() < 0.25 ? ` ${pick(data.names.epithet, rng)}` : '';
  return `${first} ${last}${ep}`;
}

export function tierForLevel(data: RandomData, level: number): RandomTier {
  return data.tiers.find((t) => level >= t.minLevel && level <= t.maxLevel) ?? data.tiers[data.tiers.length - 1];
}

/** incontro casuale per il tier di livello della party */
export function rollEncounter(data: RandomData, partyLevel: number, rng: Rng = defaultRng): RandomEncounterEntry & { tier: string } {
  const tier = tierForLevel(data, partyLevel);
  return { ...pick(tier.encounters, rng), tier: tier.tier };
}

/** tesoro casuale per il tier di livello della party */
export function rollTreasure(data: RandomData, partyLevel: number, rng: Rng = defaultRng): RandomTreasureEntry & { tier: string } {
  const tier = tierForLevel(data, partyLevel);
  return { ...pick(tier.treasure, rng), tier: tier.tier };
}
