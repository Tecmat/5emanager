import { DEFAULT_HOUSE_RULES, type AbilityScores, type Character } from './types.js';
import type { Registry } from './registry.js';
import { computeSpellSlots } from './rules/levelup.js';
import { maxHp } from './rules/derived.js';

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
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
  char.spellSlots = computeSpellSlots(char, reg);
  char.hp.current = maxHp(char, reg);
  return { character: char, errors: [] };
}

export function addXp(char: Character, amount: number): Character {
  return { ...char, xp: Math.max(0, char.xp + amount), updatedAt: new Date().toISOString() };
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
  return { ...char, hp: { current: Math.max(0, current), temp: Math.max(0, temp) }, updatedAt: new Date().toISOString() };
}

export function heal(char: Character, amount: number, max: number): Character {
  return { ...char, hp: { ...char.hp, current: Math.min(max, char.hp.current + amount) }, updatedAt: new Date().toISOString() };
}
