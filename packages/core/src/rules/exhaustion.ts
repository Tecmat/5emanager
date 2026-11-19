import type { Character } from '../types.js';

export const EXHAUSTION_MAX = 6;

export interface ExhaustionEffects {
  /** liv 1: svantaggio alle prove di caratteristica */
  disadvantageChecks: boolean;
  /** liv 2: velocità dimezzata */
  speedHalved: boolean;
  /** liv 3: svantaggio ad attacchi e TS */
  disadvantageAttacksAndSaves: boolean;
  /** liv 4: PF massimi dimezzati */
  maxHpHalved: boolean;
  /** liv 5: velocità 0 */
  speedZero: boolean;
  /** liv 6: morte */
  dead: boolean;
}

export function exhaustionEffects(char: Character): ExhaustionEffects {
  const lvl = Math.max(0, Math.min(EXHAUSTION_MAX, char.exhaustion ?? 0));
  return {
    disadvantageChecks: lvl >= 1,
    speedHalved: lvl >= 2,
    disadvantageAttacksAndSaves: lvl >= 3,
    maxHpHalved: lvl >= 4,
    speedZero: lvl >= 5,
    dead: lvl >= 6,
  };
}

/** imposta il livello di esaurimento (0-6); a 6 il PG muore (0 PF) */
export function setExhaustion(char: Character, level: number): Character {
  const lvl = Math.max(0, Math.min(EXHAUSTION_MAX, Math.round(level)));
  const next: Character = { ...char, exhaustion: lvl, updatedAt: new Date().toISOString() };
  if (lvl >= EXHAUSTION_MAX) next.hp = { ...next.hp, current: 0 };
  return next;
}

export function addExhaustion(char: Character, amount: number): Character {
  return setExhaustion(char, (char.exhaustion ?? 0) + amount);
}
