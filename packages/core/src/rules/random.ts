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

// ---------------------------------------------------------------------------
// Generatore di dungeon (tabelle in data-srd/data/dungeon.json)
// ---------------------------------------------------------------------------

export interface DungeonRoomDef {
  type: string;
  desc: string;
  trapChance: number;
  monsterChance: number;
  treasure?: boolean;
}

export interface DungeonData {
  nameParts: { prefix: string[]; core: string[] };
  rooms: DungeonRoomDef[];
  traps: string[];
  monsters: string[];
  treasures: RandomTreasureEntry[];
}

export interface DungeonRoom {
  n: number;
  type: string;
  desc: string;
  trap?: string;
  monster?: string;
  treasure?: RandomTreasureEntry;
}

export interface Dungeon {
  name: string;
  rooms: DungeonRoom[];
}

/** genera un dungeon casuale con `count` stanze (default 6) */
export function randomDungeon(data: DungeonData, count = 6, rng: Rng = defaultRng): Dungeon {
  const name = `${pick(data.nameParts.prefix, rng)} ${pick(data.nameParts.core, rng)}`;
  const rooms: DungeonRoom[] = [];
  for (let i = 0; i < count; i++) {
    const def = pick(data.rooms, rng);
    const room: DungeonRoom = { n: i + 1, type: def.type, desc: def.desc };
    if (rng() < def.trapChance) room.trap = pick(data.traps, rng);
    if (rng() < def.monsterChance) room.monster = pick(data.monsters, rng);
    if (def.treasure && rng() < 0.8) room.treasure = pick(data.treasures, rng);
    rooms.push(room);
  }
  return { name, rooms };
}
