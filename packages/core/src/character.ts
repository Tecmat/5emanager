import { ABILITIES, DEFAULT_HOUSE_RULES, type Ability, type AbilityScores, type Character } from './types.js';
import type { Registry } from './registry.js';
import { computeSpellSlots } from './rules/levelup.js';
import { maxHp } from './rules/derived.js';
import { rollDice } from './rules/dice.js';

export type StatGenMode = 'standard' | 'pointbuy' | 'roll';

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export function pointCostTo(score: number): number {
  if (score < POINT_BUY_MIN) return Infinity;
  if (score > POINT_BUY_MAX) return Infinity;
  return POINT_BUY_COST[score];
}

export function pointBuySpent(scores: Partial<AbilityScores>): number {
  let spent = 0;
  for (const v of Object.values(scores)) {
    if (typeof v === 'number') spent += pointCostTo(v);
  }
  return spent;
}

export function isPointBuyValid(scores: Partial<AbilityScores>): boolean {
  for (const ab of ABILITIES) {
    const v = scores[ab];
    if (typeof v !== 'number' || v < POINT_BUY_MIN || v > POINT_BUY_MAX) return false;
  }
  return pointBuySpent(scores) <= POINT_BUY_BUDGET;
}

/** tira 4d6 e scarta il dado più basso */
export function roll4d6DropLowest(): number {
  const r = rollDice('4d6');
  if (!r || r.rolls.length < 4) return 10;
  return r.total - Math.min(...r.rolls);
}

export function generateAbilityScores(mode: StatGenMode): AbilityScores {
  if (mode === 'standard') {
    const scores = {} as AbilityScores;
    ABILITIES.forEach((ab, i) => { scores[ab] = STANDARD_ARRAY[i]; });
    return scores;
  }
  if (mode === 'roll') {
    const scores = {} as AbilityScores;
    for (const ab of ABILITIES) scores[ab] = roll4d6DropLowest();
    return scores;
  }
  const scores = {} as AbilityScores;
  for (const ab of ABILITIES) scores[ab] = POINT_BUY_MIN;
  return scores;
}

export function abilityForIndex(i: number): Ability {
  return ABILITIES[i];
}

export interface CreateCharacterInput {
  name: string;
  raceId: string;
  subraceId?: string;
  classId: string;
  abilityScores: AbilityScores;
  skillChoices?: string[];
  background?: string;
  alignment?: string;
}

export function createCharacter(input: CreateCharacterInput, reg: Registry): { character?: Character; errors: string[] } {
  const errors: string[] = [];
  const race = reg.races.get(input.raceId);
  if (!race) errors.push('Razza non trovata: ' + input.raceId);
  const cls = reg.classes.get(input.classId);
  if (!cls) errors.push('Classe non trovata: ' + input.classId);
  let subrace = undefined;
  if (input.subraceId) {
    subrace = race?.subraces.find((s) => s.id === input.subraceId);
    if (race && !subrace) errors.push('Sottorazza non valida per questa razza');
  }
  for (const [ab, v] of Object.entries(input.abilityScores)) {
    if (typeof v !== 'number' || v < 1 || v > 20) errors.push(`Punteggio ${ab} non valido (1-20): ${v}`);
  }
  if (errors.length > 0) return { errors };

  const scores: AbilityScores = { ...input.abilityScores };
  for (const [ab, b] of Object.entries(race!.abilityBonuses)) scores[ab as keyof AbilityScores] += b;
  if (subrace) for (const [ab, b] of Object.entries(subrace.abilityBonuses)) scores[ab as keyof AbilityScores] += b;

  const skills = (input.skillChoices ?? []).slice(0, cls!.skillChoices.choose);

  const now = new Date().toISOString();
  const char: Character = {
    id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    portrait: undefined,
    houseRules: { ...DEFAULT_HOUSE_RULES },
    raceId: race!.id,
    subraceId: subrace?.id,
    background: input.background,
    alignment: input.alignment,
    xp: 0,
    inspiration: false,
    abilityScores: scores,
    classLevels: [{ classId: cls!.id, level: 1, hitDiceRolled: [cls!.hitDie] }],
    proficiency: {
      skills,
      expertise: [],
      weapons: [...cls!.weaponProficiencies],
      armors: [...cls!.armorProficiencies],
      tools: [...cls!.toolProficiencies],
      languages: [],
    },
    fightingStyles: [],
    feats: [],
    features: (cls!.features[1] ?? []).map((f) => f.id),
    spellsKnown: [],
    spellsPrepared: [],
    spellSlots: {},
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    hp: { current: 0, temp: 0 },
    deathSaves: { successes: 0, failures: 0 },
    conditions: [],
    journal: [],
    favoriteSpells: [],
    exhaustion: 0,
    spellsPreparedByClass: {},
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
  char.spellSlots = computeSpellSlots(char, reg);
  char.hp.current = maxHp(char, reg);
  return { character: char, errors: [] };
}

/** riempie i campi nuovi mancanti nelle schede salvate con versioni precedenti */
export function migrateCharacter(char: Character): Character {
  const conditions = char.conditions ?? [];
  // migra la vecchia condizione "exhaustion-N" nel campo exhaustion
  let exhaustion = char.exhaustion ?? 0;
  const kept = conditions.filter((c) => {
    const m = c.match(/^exhaustion-(\d)$/);
    if (m) exhaustion = Math.max(exhaustion, Number(m[1]));
    return !m;
  });
  // migra spellsPrepared nel formato per-classe (prima classe)
  const spellsPreparedByClass = char.spellsPreparedByClass ?? {};
  if (Object.keys(spellsPreparedByClass).length === 0 && (char.spellsPrepared?.length ?? 0) > 0) {
    const firstClass = char.classLevels[0]?.classId ?? 'default';
    spellsPreparedByClass[firstClass] = [...(char.spellsPrepared ?? [])];
  }
  return {
    ...char,
    houseRules: { ...DEFAULT_HOUSE_RULES, ...(char.houseRules ?? {}) },
    conditions: kept,
    journal: char.journal ?? [],
    favoriteSpells: char.favoriteSpells ?? [],
    exhaustion,
    spellsPreparedByClass,
    deathSaves: char.deathSaves ?? { successes: 0, failures: 0 },
  };
}

const JOURNAL_MAX = 200;

/** aggiunge una voce al diario di sessione (max 200, le più vecchie vengono scartate) */
export function logJournal(char: Character, text: string): Character {
  const entry = { at: new Date().toISOString(), text };
  return { ...char, journal: [...(char.journal ?? []), entry].slice(-JOURNAL_MAX), updatedAt: entry.at };
}

export function addXp(char: Character, amount: number): Character {
  const next = { ...char, xp: Math.max(0, char.xp + amount), updatedAt: new Date().toISOString() };
  return amount > 0 ? logJournal(next, `+${amount} XP (totale ${next.xp})`) : next;
}

export function damage(char: Character, amount: number): Character {
  let { current, temp } = char.hp;
  if (temp > 0) {
    const absorbed = Math.min(temp, amount);
    temp -= absorbed;
    current -= amount - absorbed;
  } else {
    current -= amount;
  }
  const next = { ...char, hp: { current: Math.max(0, current), temp: Math.max(0, temp) }, updatedAt: new Date().toISOString() };
  return amount > 0 ? logJournal(next, `Subisce ${amount} danni (PF ${next.hp.current})`) : next;
}

export function heal(char: Character, amount: number, max: number): Character {
  const wasDown = char.hp.current <= 0;
  const next = { ...char, hp: { ...char.hp, current: Math.min(max, char.hp.current + amount) }, updatedAt: new Date().toISOString() };
  // curare da 0 PF: risveglia con 1 PF e resetta i tiri della morte
  if (wasDown && next.hp.current > 0) {
    next.hp.current = Math.max(1, next.hp.current);
    next.deathSaves = { successes: 0, failures: 0 };
    return logJournal(next, `Risveglia da 0 PF con ${next.hp.current} PF`);
  }
  return amount > 0 ? logJournal(next, `Cura ${amount} PF (PF ${next.hp.current})`) : next;
}

/** registra un tiro della morte (a 0 PF): 3 successi = torni a 1 PF, 3 fallimenti = morto */
export function recordDeathSave(char: Character, success: boolean): Character {
  const ds = { ...(char.deathSaves ?? { successes: 0, failures: 0 }) };
  if (success) ds.successes = Math.min(3, ds.successes + 1);
  else ds.failures = Math.min(3, ds.failures + 1);
  const revived = ds.successes >= 3;
  const next = {
    ...char,
    deathSaves: ds,
    hp: revived ? { current: 1, temp: char.hp.temp } : char.hp,
    updatedAt: new Date().toISOString(),
  };
  return logJournal(next, revived ? 'Tiro della morte: 3 successi — torna a 1 PF' : `Tiro della morte: ${success ? 'successo' : 'fallimento'} (${ds.successes}✓/${ds.failures}✗)`);
}

export function isDead(char: Character): boolean {
  return char.hp.current <= 0 && (char.deathSaves?.failures ?? 0) >= 3;
}
