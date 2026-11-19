import type { Character } from '../types.js';

export interface ConditionDef {
  id: string;
  name: string;
  description: string;
  /** se true, il tiro di dado del personaggio ha svantaggio (es. avvelenato, spaventato) */
  imposesDisadvantage?: boolean;
}

export const CONDITIONS: ConditionDef[] = [
  { id: 'blinded', name: 'Cieco', description: 'Non vede; attacchi con svantaggio, attacks contro di lui con vantaggio.' },
  { id: 'charmed', name: 'Ammaliato', description: 'Non può attaccare chi lo ha ammaliato; TS Car con vantaggio per lui.' },
  { id: 'deafened', name: 'Sordo', description: 'Non sente; fallisce prove che richiedono l\'udito.' },
  { id: 'frightened', name: 'Spaventato', description: 'Svantaggio a prove e attacchi; non può avvicinarsi alla fonte di paura.', imposesDisadvantage: true },
  { id: 'grappled', name: 'Afferrato', description: 'Velocità 0; prova Des per liberarsi.' },
  { id: 'incapacitated', name: 'Incapacitato', description: 'Nessuna azione né réaction.' },
  { id: 'invisible', name: 'Invisibile', description: 'Impossibile da vedere senza magie; attacchi con vantaggio, attacchi contro di lui con svantaggio.' },
  { id: 'paralyzed', name: 'Paralizzato', description: 'Incapacitato, non si muove, fallisce TS Str e Des, colpi entro 1,5 m sono critici automatici.', imposesDisadvantage: true },
  { id: 'petrified', name: 'Pietrificato', description: 'Trasformato in pietra: incapacitato, resistenza a tutti i danni, immune a veleno/malattia.' },
  { id: 'poisoned', name: 'Avvelenato', description: 'Svantaggio ad attacchi e prove di caratteristica.', imposesDisadvantage: true },
  { id: 'prone', name: 'Prono', description: 'Svantaggio agli attacchi; attacchi in mischia contro di lui con vantaggio, a distanza con svantaggio.' },
  { id: 'restrained', name: 'Trattenuto', description: 'Velocità 0, svantaggio ad attacchi e TS Des, attacchi contro di lui con vantaggio.', imposesDisadvantage: true },
  { id: 'stunned', name: 'Stordito', description: 'Incapacitato, non si muove, fallisce TS Str e Des, attacchi contro di lui con vantaggio.' },
  { id: 'unconscious', name: 'Privo di sensi', description: 'Incapacitato, prono, fallisce TS Str/Des, colpi entro 1,5 m critici automatici.' },
  { id: 'exhaustion-1', name: 'Esaurimento 1', description: 'Svantaggio alle prove di characteristic.' },
  { id: 'concentrating', name: 'Concentrato', description: 'Sta lanciando un incantesimo a concentración; TS Con CD 10 o metà danni per mantenerlo.' },
];

export function conditionDef(id: string): ConditionDef | undefined {
  return CONDITIONS.find((c) => c.id === id);
}

export function addCondition(char: Character, id: string): Character {
  if (!conditionDef(id)) throw new Error('Condizione sconosciuta: ' + id);
  if (char.conditions.includes(id)) return char;
  return { ...char, conditions: [...char.conditions, id], updatedAt: new Date().toISOString() };
}

export function removeCondition(char: Character, id: string): Character {
  return { ...char, conditions: char.conditions.filter((c) => c !== id), updatedAt: new Date().toISOString() };
}

export function hasCondition(char: Character, id: string): boolean {
  return char.conditions.includes(id);
}

/** svantaggio sui tiri del personaggio a causa delle condizioni attive */
export function hasDisadvantageFromConditions(char: Character): boolean {
  return char.conditions.some((c) => conditionDef(c)?.imposesDisadvantage);
}
