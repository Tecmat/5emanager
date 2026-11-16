import type { Character, SpellDef } from '../types.js';
import type { Registry } from '../registry.js';
import { casterLevel, cantripsKnown } from './levelup.js';
import { maxHp } from './derived.js';

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

export function addSpellKnown(char: Character, spellId: string, reg: Registry): { character: Character; error?: string } {
  const spell = reg.spells.get(spellId);
  if (!spell) return { character: char, error: 'Incantesimo non trovato: ' + spellId };
  if (char.spellsKnown.includes(spellId)) return { character: char, error: 'Incantesimo già conosciuto' };
  const next = { ...char, spellsKnown: [...char.spellsKnown, spellId], updatedAt: new Date().toISOString() };
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
