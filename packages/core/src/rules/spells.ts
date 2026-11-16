import type { Character, SpellDef } from '../types.js';
import type { Registry } from '../registry.js';
import { casterLevel, cantripsKnown } from './levelup.js';
import { abilityModifier, maxHp } from './derived.js';

export interface CasterSummary {
  classId: string;
  ability: string;
  casterLevel: number;
  prepare: boolean;
  cantripsKnown: number;
  slots: Record<number, { total: number; used: number }>;
}

export function castersOf(char: Character, reg: Registry): CasterSummary[] {
  const out: CasterSummary[] = [];
  for (const cl of char.classLevels) {
    const cls = reg.classes.get(cl.classId);
    const sc = cls?.spellcasting;
    if (!sc || cl.level === 0) continue;
    out.push({
      classId: cls.id,
      ability: sc.ability,
      casterLevel: casterLevel(char, reg),
      prepare: sc.prepare,
      cantripsKnown: cantripsKnown(char, reg),
      slots: char.spellSlots,
    });
  }
  return out;
}

/** incantesimi che il personaggio può conoscere/preparare in base alle sue classi */
export function learnableSpells(char: Character, reg: Registry): SpellDef[] {
  const classIds = new Set(char.classLevels.map((c) => c.classId));
  return [...reg.spells.values()].filter((s) => !s.classes || s.classes.some((c) => classIds.has(c)));
}

export function isSpellKnown(char: Character, spellId: string): boolean {
  return char.spellsKnown.includes(spellId);
}

/** massimo di incantesimi di livello >= 1 conoscibili, secondo le regole delle classi del personaggio */
export function maxSpellsKnown(char: Character, reg: Registry): number {
  let max = 0;
  for (const cl of char.classLevels) {
    const sc = reg.classes.get(cl.classId)?.spellcasting;
    if (!sc || cl.level === 0) continue;
    const sk = sc.spellsKnown;
    if (sk === 'all' || sk === undefined) return Infinity;
    if (sk === 'levelPlusMod') max += Math.max(1, cl.level + abilityModifier(char.abilityScores[sc.ability]));
    else max += sk[cl.level] ?? 0;
  }
  return max;
}

export function knownSpellCount(char: Character, reg: Registry): number {
  return char.spellsKnown.filter((id) => (reg.spells.get(id)?.level ?? 0) > 0).length;
}

export function addSpellKnown(char: Character, spellId: string, reg: Registry): { character: Character; error?: string } {
  const spell = reg.spells.get(spellId);
  if (!spell) return { character: char, error: 'Incantesimo non trovato: ' + spellId };
  if (char.spellsKnown.includes(spellId)) return { character: char, error: 'Incantesimo già conosciuto' };
  if (spell.level > 0 && !char.houseRules.bypassSpellLimit) {
    const max = maxSpellsKnown(char, reg);
    if (max !== Infinity && knownSpellCount(char, reg) >= max) {
      return { character: char, error: `Limite raggiunto: ${knownSpellCount(char, reg)}/${max} incantesimi conosciuti (dimenticane uno o attiva l'house-rule)` };
    }
  }
  const next = { ...char, spellsKnown: [...char.spellsKnown, spellId], updatedAt: new Date().toISOString() };
  return { character: next };
}

export function forgetSpell(char: Character, spellId: string): { character: Character; error?: string } {
  if (!char.spellsKnown.includes(spellId)) return { character: char, error: 'Incantesimo non conosciuto' };
  const next: Character = {
    ...char,
    spellsKnown: char.spellsKnown.filter((s) => s !== spellId),
    spellsPrepared: char.spellsPrepared.filter((s) => s !== spellId),
    updatedAt: new Date().toISOString(),
  };
  return { character: next };
}

export function prepareSpell(char: Character, spellId: string, reg: Registry): { character: Character; error?: string } {
  const spell = reg.spells.get(spellId);
  if (!spell) return { character: char, error: 'Incantesimo non trovato: ' + spellId };
  if (!char.spellsKnown.includes(spellId)) return { character: char, error: 'Devi prima conoscere l\'incantesimo' };
  if (char.spellsPrepared.includes(spellId)) return { character: char, error: 'Incantesimo già preparato' };
  const next = { ...char, spellsPrepared: [...char.spellsPrepared, spellId], updatedAt: new Date().toISOString() };
  return { character: next };
}

export interface CastResult {
  character: Character;
  error?: string;
}

/** lancia un incantesimo consumando uno slot di livello >= al livello dell'incantesimo (upcast) */
export function castSpell(char: Character, spellId: string, slotLevel: number, reg: Registry): CastResult {
  const spell = reg.spells.get(spellId);
  if (!spell) return { character: char, error: 'Incantesimo non trovato: ' + spellId };
  if (!char.spellsKnown.includes(spellId)) return { character: char, error: 'Incantesimo non conosciuto' };
  if (slotLevel < spell.level) return { character: char, error: `Slot di livello ${slotLevel} insufficiente per un incantesimo di livello ${spell.level}` };
  if (slotLevel > 9) return { character: char, error: 'Gli slot di patto (warlock) vanno lanciati al loro livello' };
  const slot = char.spellSlots[slotLevel];
  if (!slot || slot.total <= 0) return { character: char, error: `Nessuno slot di livello ${slotLevel} disponibile` };
  if (slot.used >= slot.total) return { character: char, error: `Slot di livello ${slotLevel} esauriti (${slot.used}/${slot.total})` };

  const next: Character = {
    ...char,
    spellSlots: { ...char.spellSlots, [slotLevel]: { total: slot.total, used: slot.used + 1 } },
    concentrationSpellId: spell.concentration ? spellId : char.concentrationSpellId,
    updatedAt: new Date().toISOString(),
  };
  return { character: next };
}

/** riposo lungo: recupera slot, HP e concentration */
export function longRest(char: Character, reg: Registry): Character {
  const slots: Character['spellSlots'] = {};
  for (const [k, v] of Object.entries(char.spellSlots)) slots[Number(k)] = { total: v.total, used: 0 };
  return {
    ...char,
    spellSlots: slots,
    hp: { current: maxHp(char, reg), temp: 0 },
    concentrationSpellId: undefined,
    updatedAt: new Date().toISOString(),
  };
}
