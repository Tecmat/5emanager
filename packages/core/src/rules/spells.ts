import type { Character, SpellDef } from '../types.js';
import type { Registry } from '../registry.js';
import { casterLevel, cantripsKnown } from './levelup.js';
import { abilityModifier, maxHp, modifierOf, totalLevel } from './derived.js';
import { updateItem, useCharge } from './inventory.js';
import { rollDice } from './dice.js';
import { logJournal } from '../character.js';

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
/** livello massimo degli slot incantesimo del PG (0 = solo trucchetti) */
export function maxSpellSlotLevel(char: Character): number {
  let max = 0;
  for (const [lvl, s] of Object.entries(char.spellSlots ?? {})) {
    if (s && s.total > 0 && Number(lvl) > max) max = Number(lvl);
  }
  return max;
}

/** quanti trucchetti il PG conosce ora */
export function knownCantripCount(char: Character, reg: Registry): number {
  return char.spellsKnown.filter((id) => (reg.spells.get(id)?.level ?? 0) === 0).length;
}

export function learnableSpells(char: Character, reg: Registry): SpellDef[] {
  const classIds = new Set(char.classLevels.map((c) => c.classId));
  // non si possono imparare incantesimi di livello superiore agli slot disponibili (RAW)
  const maxSlot = char.houseRules.bypassSpellLimit ? 9 : maxSpellSlotLevel(char);
  return [...reg.spells.values()].filter((s) => {
    if (s.classes && !s.classes.some((c) => classIds.has(c))) return false;
    return s.level <= maxSlot;
  });
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
  if (!char.houseRules.bypassSpellLimit) {
    if (spell.level > 0) {
      // RAW: niente incantesimi di livello superiore al proprio slot massimo
      const maxSlot = maxSpellSlotLevel(char);
      if (spell.level > maxSlot) {
        return { character: char, error: `Non puoi imparare un incantesimo di ${spell.level}° livello: i tuoi slot vanno fino al ${maxSlot}° (livella ancora)` };
      }
      const max = maxSpellsKnown(char, reg);
      if (max !== Infinity && knownSpellCount(char, reg) >= max) {
        return { character: char, error: `Limite raggiunto: ${knownSpellCount(char, reg)}/${max} incantesimi conosciuti (dimenticane uno o attiva l'house-rule)` };
      }
    } else {
      // limite trucchetti per classe
      const ck = cantripsKnown(char, reg);
      const cur = knownCantripCount(char, reg);
      if (cur >= ck) {
        return { character: char, error: `Limite trucchetti raggiunto: ${cur}/${ck} (dimenticane uno, livella, o attiva l'house-rule)` };
      }
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

// --- preparazione per classe (multiclasse) ---

function syncPreparedUnion(char: Character, byClass: Record<string, string[]>): Character {
  const union = [...new Set(Object.values(byClass).flat())];
  return { ...char, spellsPreparedByClass: byClass, spellsPrepared: union };
}

/** prima classe del PG che prepara incantesimi */
export function firstPreparingClass(char: Character, reg: Registry): string | null {
  for (const cl of char.classLevels) {
    const sc = reg.classes.get(cl.classId)?.spellcasting;
    if (sc?.prepare && cl.level > 0) return cl.classId;
  }
  return null;
}

export function preparedSpellsOfClass(char: Character, classId: string): string[] {
  return char.spellsPreparedByClass?.[classId] ?? char.spellsPrepared ?? [];
}

export function prepareSpellForClass(char: Character, spellId: string, classId: string, reg: Registry): { character: Character; error?: string } {
  const spell = reg.spells.get(spellId);
  if (!spell) return { character: char, error: 'Incantesimo non trovato: ' + spellId };
  if (!char.spellsKnown.includes(spellId)) return { character: char, error: 'Devi prima conoscere l\'incantesimo' };
  const cls = reg.classes.get(classId);
  const sc = cls?.spellcasting;
  if (!sc?.prepare) return { character: char, error: `${cls?.name ?? classId} non prepara incantesimi` };
  const list = preparedSpellsOfClass(char, classId);
  if (list.includes(spellId)) return { character: char, error: 'Incantesimo già preparato per questa classe' };
  // RAW: non si prepara un incantesimo di livello superiore ai propri slot
  if (!char.houseRules.bypassSpellLimit && spell.level > maxSpellSlotLevel(char)) {
    return { character: char, error: `Non puoi preparare un incantesimo di ${spell.level}° livello: i tuoi slot vanno fino al ${maxSpellSlotLevel(char)}°` };
  }
  const byClass = { ...(char.spellsPreparedByClass ?? {}) };
  // un incantesimo può essere preparato da una sola classe alla volta
  for (const k of Object.keys(byClass)) byClass[k] = byClass[k].filter((s) => s !== spellId);
  byClass[classId] = [...list, spellId];
  return { character: syncPreparedUnion(char, byClass) };
}

export function unprepareSpellForClass(char: Character, spellId: string, classId: string): Character {
  const byClass = { ...(char.spellsPreparedByClass ?? {}) };
  if (byClass[classId]) byClass[classId] = byClass[classId].filter((s) => s !== spellId);
  return syncPreparedUnion(char, byClass);
}

/** compatibilità: prepara con la prima classe che prepara */
export function prepareSpell(char: Character, spellId: string, reg: Registry): { character: Character; error?: string } {
  const cls = firstPreparingClass(char, reg);
  if (!cls) return { character: char, error: 'Nessuna classe prepara incantesimi' };
  return prepareSpellForClass(char, spellId, cls, reg);
}

export interface CastResult {
  character: Character;
  error?: string;
  ritual?: boolean;
  warning?: string;
}

/** testo del componente materiale (dopo "M (") oppure null */
export function materialText(spell: SpellDef): string | null {
  const m = spell.components.match(/M\s*\(([^)]*)\)/i);
  return m ? m[1].trim() : null;
}

/** il componente materiale viene consumato? default true se c'è M, a meno che la descrizione non dica il contrario */
export function isMaterialConsumed(spell: SpellDef): boolean {
  if (spell.materialConsumed !== undefined) return spell.materialConsumed;
  if (!materialText(spell)) return false;
  return !/non viene consumato|not consumed|non consumato/i.test(spell.description);
}

/** consuma il componente materiale dall'inventario (cariche se l'oggetto le ha, altrimenti quantità) */
export function consumeMaterialComponent(char: Character, spell: SpellDef): { character: Character; consumed?: string; warning?: string } {
  const mat = materialText(spell);
  if (!mat || !isMaterialConsumed(spell)) return { character: char };
  const matLower = mat.toLowerCase();
  const item = char.inventory.find((i) => {
    const n = i.name.toLowerCase();
    return (n.length >= 4 && matLower.includes(n)) || (matLower.length >= 4 && n.includes(matLower));
  });
  if (!item) return { character: char, warning: `Componente materiale non trovato nell'inventario: ${mat}` };
  if (item.charges) {
    if (item.charges.current <= 0) return { character: char, warning: `${item.name} ha 0 cariche` };
    return { character: updateItem(char, item.id, { charges: { ...item.charges, current: item.charges.current - 1 } }), consumed: item.name };
  }
  if (item.quantity <= 1) return { character: char, warning: `Serve: ${mat} (ne hai solo ${item.quantity})` };
  return { character: updateItem(char, item.id, { quantity: item.quantity - 1 }), consumed: item.name };
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

  let next: Character = {
    ...char,
    spellSlots: { ...char.spellSlots, [slotLevel]: { total: slot.total, used: slot.used + 1 } },
    concentrationSpellId: spell.concentration ? spellId : char.concentrationSpellId,
    updatedAt: new Date().toISOString(),
  };
  const mat = consumeMaterialComponent(next, spell);
  next = mat.character;
  const up = upcastExtraDice(spell, slotLevel);
  const upText = up ? ` — upcast +${up}` : '';
  return { character: logJournal(next, `Lancia ${spell.name} (slot ${slotLevel}°)${upText}`), warning: mat.warning };
}

/**
 * dado/dadi extra dell'upcast: cerca nell'higherLevel del testo pattern "+NdM"
 * (es. "+1d6 per ogni slot di livello superiore") e moltiplica per gli slot extra.
 * Ritorna es. "3d6" oppure null se non c'è upcast di danno.
 */
export function upcastExtraDice(spell: SpellDef, slotLevel: number): string | null {
  if (slotLevel <= spell.level || !spell.higherLevel) return null;
  const m = spell.higherLevel.match(/\+\s*(\d+)\s*d\s*(\d+)/i);
  if (!m) return null;
  const perSlot = Number(m[1]);
  const faces = Number(m[2]);
  const extra = perSlot * (slotLevel - spell.level);
  if (extra <= 0) return null;
  return `${extra}d${faces}`;
}

/** anteprima del danno con upcast: base + extra (solo testo, es. { base: '8d6', extra: '2d6' }) */
export function spellDamagePreview(spell: SpellDef, slotLevel: number): { base?: string; extra?: string } {
  return { base: spell.damage, extra: upcastExtraDice(spell, slotLevel) ?? undefined };
}

/** aggiunge/rimuove un incantesimo dai preferiti ⭐ */
export function toggleFavoriteSpell(char: Character, spellId: string): Character {
  const has = (char.favoriteSpells ?? []).includes(spellId);
  return {
    ...char,
    favoriteSpells: has ? char.favoriteSpells.filter((s) => s !== spellId) : [...(char.favoriteSpells ?? []), spellId],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * lancia l'incantesimo di un oggetto (pergamena/bacchetta: item.spellId) spendendo 1 carica,
 * SENZA consumare slot (come una pergamena) e senza componenti materiali.
 */
export function castItemSpell(char: Character, itemId: string, reg: Registry): CastResult {
  const item = char.inventory.find((i) => i.id === itemId);
  if (!item) return { character: char, error: 'Oggetto non trovato' };
  if (!item.spellId) return { character: char, error: 'Questo oggetto non lancia incantesimi' };
  const spell = reg.spells.get(item.spellId);
  if (!spell) return { character: char, error: 'Incantesimo non trovato: ' + item.spellId };
  if (!item.charges || item.charges.current <= 0) return { character: char, error: `${item.name} non ha cariche` };
  const used = useCharge(char, itemId);
  if (used.error) return { character: char, error: used.error };
  const next: Character = {
    ...used.character,
    concentrationSpellId: spell.concentration ? spell.id : used.character.concentrationSpellId,
    updatedAt: new Date().toISOString(),
  };
  return { character: logJournal(next, `Usa ${item.name} per lanciare ${spell.name} (${item.charges!.max - item.charges!.current + 1}/${item.charges!.max} cariche)`) };
}

/** lancio come rituale: nessuno slot consumato (richiede spell.ritual), +10 minuti */
export function castSpellRitual(char: Character, spellId: string, reg: Registry): CastResult {
  const spell = reg.spells.get(spellId);
  if (!spell) return { character: char, error: 'Incantesimo non trovato: ' + spellId };
  if (!spell.ritual) return { character: char, error: 'Questo incantesimo non è un rituale' };
  if (!char.spellsKnown.includes(spellId)) return { character: char, error: 'Incantesimo non conosciuto' };
  let next: Character = {
    ...char,
    concentrationSpellId: spell.concentration ? spellId : char.concentrationSpellId,
    updatedAt: new Date().toISOString(),
  };
  const mat = consumeMaterialComponent(next, spell);
  next = mat.character;
  return { character: logJournal(next, `Lancia ${spell.name} come rituale`), ritual: true, warning: mat.warning };
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

/**
 * riposo breve: spende fino a `dice` dadi vita (max = livello totale), cura il tiro + mod Cos per dado.
 * Il dado vita usato è quello della classe con più livelli. Curare da 0 PF risveglia e resetta i tiri della morte.
 */
export function shortRest(char: Character, reg: Registry, dice = 1): { character: Character; healed: number; rolls: string[] } {
  const conMod = modifierOf(char, 'con');
  const max = maxHp(char, reg);
  const n = Math.max(0, Math.min(dice, totalLevel(char)));
  const main = [...char.classLevels].sort((a, b) => b.level - a.level)[0];
  const die = reg.classes.get(main?.classId ?? '')?.hitDie ?? 8;
  const rolls: string[] = [];
  let cur = char;
  let healed = 0;
  for (let i = 0; i < n; i++) {
    const r = rollDice(`1d${die}`);
    const rolled = r?.total ?? Math.floor(die / 2) + 1;
    const amount = Math.max(0, rolled + conMod);
    rolls.push(`1d${die}=${rolled}${conMod >= 0 ? '+' : ''}${conMod}`);
    const wasDown = cur.hp.current <= 0;
    const newCur = Math.min(max, cur.hp.current + amount);
    healed += Math.max(0, newCur - cur.hp.current);
    cur = {
      ...cur,
      hp: { current: wasDown && newCur > 0 ? Math.max(1, newCur) : newCur, temp: cur.hp.temp },
      deathSaves: wasDown && newCur > 0 ? { successes: 0, failures: 0 } : cur.deathSaves,
      updatedAt: new Date().toISOString(),
    };
  }
  const next = logJournal(cur, n > 0 ? `Riposo breve: ${n} dado/i vita (${rolls.join(', ')}) → +${healed} PF` : 'Riposo breve (nessun dado vita speso)');
  return { character: next, healed, rolls };
}
