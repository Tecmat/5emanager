import { ABILITIES } from './types.js';
import type { ArmorDef, ClassDef, EnemyDef, FeatDef, RaceDef, SpellDef, SubclassDef, WeaponDef } from './types.js';

const DICE_RE = /^\d+d\d+(\s*[+-]\s*\d+)?$/;
const MULTI_DICE_RE = /^(\d+d\d+(\s*[+-]\s*\d+)?\s*\+\s*)*\d+d\d+(\s*[+-]\s*\d+)?$/;

export function isValidDice(expr: string): boolean {
  const e = expr.trim();
  if (/^\d+$/.test(e)) return true;
  return DICE_RE.test(e) || MULTI_DICE_RE.test(e);
}

function isId(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

function req(obj: Record<string, unknown>, field: string, errors: string[]): void {
  if (obj[field] === undefined || obj[field] === null || obj[field] === '') errors.push(`campo obbligatorio mancante: ${field}`);
}

export function validateSpellDef(s: Partial<SpellDef>): string[] {
  const errors: string[] = [];
  const o = s as Record<string, unknown>;
  if (!isId(s.id)) errors.push('id non valido (usa lettere minuscole, numeri e trattini)');
  req(o, 'name', errors);
  if (typeof s.level !== 'number' || s.level < 0 || s.level > 9 || !Number.isInteger(s.level)) errors.push('level deve essere un intero 0-9');
  if (typeof s.school !== 'string' || s.school.length === 0) errors.push('school mancante');
  for (const f of ['castingTime', 'range', 'components', 'duration', 'description'] as const) req(o, f, errors);
  if (s.damage !== undefined && !isValidDice(s.damage)) errors.push(`dado danno non valido: ${s.damage}`);
  return errors;
}

export function validateWeaponDef(w: Partial<WeaponDef>): string[] {
  const errors: string[] = [];
  const o = w as Record<string, unknown>;
  if (!isId(w.id)) errors.push('id non valido');
  req(o, 'name', errors);
  if (w.category !== 'simple' && w.category !== 'martial') errors.push('category deve essere simple o martial');
  if (w.type !== 'melee' && w.type !== 'ranged') errors.push('type deve essere melee o ranged');
  if (typeof w.damage !== 'string' || !isValidDice(w.damage)) errors.push(`dado danno non valido: ${w.damage}`);
  req(o, 'damageType', errors);
  if (typeof w.weight !== 'number' || w.weight < 0) errors.push('weight deve essere >= 0');
  if (!w.cost || typeof w.cost.value !== 'number' || w.cost.value < 0) errors.push('cost non valido');
  if (w.type === 'ranged' && w.properties?.includes('thrown') === false && !w.range) errors.push('un\'arma a distanza senza proprietà thrown richiede range');
  return errors;
}

export function validateArmorDef(a: Partial<ArmorDef>): string[] {
  const errors: string[] = [];
  const o = a as Record<string, unknown>;
  if (!isId(a.id)) errors.push('id non valido');
  req(o, 'name', errors);
  if (!['light', 'medium', 'heavy', 'shield'].includes(a.category ?? '')) errors.push('category non valida');
  if (typeof a.ac !== 'number' || a.ac < 0) errors.push('ac deve essere un numero >= 0');
  if (a.maxDex !== undefined && (a.maxDex < 0 || a.maxDex > 99)) errors.push('maxDex non valido');
  if (typeof a.weight !== 'number' || a.weight < 0) errors.push('weight deve essere >= 0');
  if (!a.cost || typeof a.cost.value !== 'number' || a.cost.value < 0) errors.push('cost non valido');
  return errors;
}

export function validateFeature(f: unknown, level: number): string[] {
  const errors: string[] = [];
  const o = f as Record<string, unknown>;
  if (!o || typeof o !== 'object') return ['feature deve essere un oggetto'];
  if (!isId(o.id as string)) errors.push(`feature a livello ${level}: id non valido`);
  req(o, 'name', errors);
  req(o, 'description', errors);
  if (!Array.isArray(o.effects)) errors.push(`feature ${o.id}: effects deve essere un array`);
  else {
    for (const e of o.effects) {
      const et = (e as Record<string, unknown>)?.type;
      if (et === 'asi' && typeof (e as Record<string, unknown>).points !== 'number') errors.push(`feature ${o.id}: asi richiede points`);
      if (et === 'subclass' && !Array.isArray((e as Record<string, unknown>).options)) errors.push(`feature ${o.id}: subclass richiede options`);
      if (et === 'spellcasting') {
        const ab = (e as Record<string, unknown>).ability;
        if (!ABILITIES.includes(ab as never)) errors.push(`feature ${o.id}: ability di spellcasting non valida`);
      }
      if (et === 'effect' && typeof (e as Record<string, unknown>).text !== 'string') errors.push(`feature ${o.id}: effect richiede text (stringa)`);
    }
  }
  return errors;
}

export function validateClassDef(c: Partial<ClassDef>): string[] {
  const errors: string[] = [];
  const o = c as Record<string, unknown>;
  if (!isId(c.id)) errors.push('id non valido');
  req(o, 'name', errors);
  if (![6, 8, 10, 12].includes(c.hitDie ?? 0)) errors.push('hitDie deve essere 6, 8, 10 o 12');
  if (!Array.isArray(c.savingThrows) || c.savingThrows.length !== 2) errors.push('savingThrows deve contenere esattamente 2 caratteristiche');
  else for (const s of c.savingThrows) if (!ABILITIES.includes(s as never)) errors.push(`saving throw non valida: ${s}`);
  if (!c.skillChoices || typeof c.skillChoices.choose !== 'number' || !Array.isArray(c.skillChoices.from)) errors.push('skillChoices non valido');
  if (!c.features || typeof c.features !== 'object') errors.push('features mancante');
  else {
    for (const [lvlStr, feats] of Object.entries(c.features)) {
      const lvl = Number(lvlStr);
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > 20) errors.push(`livello non valido nelle features: ${lvlStr}`);
      if (!Array.isArray(feats)) errors.push(`features[${lvlStr}] deve essere un array`);
      else for (const f of feats) errors.push(...validateFeature(f, lvl));
    }
  }
  if (c.spellcasting) {
    const sc = c.spellcasting;
    if (!ABILITIES.includes(sc.ability as never)) errors.push('spellcasting.ability non valida');
    if (!['full', 'half', 'third', 'pact'].includes(sc.type)) errors.push('spellcasting.type non valido');
    if (!sc.cantrips || typeof sc.cantrips !== 'object') errors.push('spellcasting.cantrips mancante');
    if (!sc.slots || typeof sc.slots !== 'object') errors.push('spellcasting.slots mancante');
    else {
      for (const [lvlStr, row] of Object.entries(sc.slots)) {
        const lvl = Number(lvlStr);
        if (!Number.isInteger(lvl) || lvl < 1 || lvl > 20) errors.push(`slot a livello non valido: ${lvlStr}`);
        if (!Array.isArray(row) || row.length > 9 || row.some((n) => typeof n !== 'number' || n < 0)) errors.push(`slot di livello ${lvlStr} non valido`);
      }
    }
  }
  return errors;
}

export function validateSubclassDef(s: Partial<SubclassDef>, classIds: Set<string>): string[] {
  const errors: string[] = [];
  if (!isId(s.id)) errors.push('id non valido');
  if (!s.classId || !classIds.has(s.classId)) errors.push('classId non valido o classe inesistente');
  if (!s.name) errors.push('name mancante');
  if (!s.features || typeof s.features !== 'object') errors.push('features mancante');
  else for (const [lvlStr, feats] of Object.entries(s.features)) {
    if (!Array.isArray(feats)) errors.push(`features[${lvlStr}] deve essere un array`);
    else for (const f of feats) errors.push(...validateFeature(f, Number(lvlStr)));
  }
  return errors;
}

export function validateRaceDef(r: Partial<RaceDef>): string[] {
  const errors: string[] = [];
  if (!isId(r.id)) errors.push('id non valido');
  if (!r.name) errors.push('name mancante');
  if (typeof r.speed !== 'number' || r.speed <= 0) errors.push('speed deve essere > 0');
  if (r.abilityBonuses) for (const [k, v] of Object.entries(r.abilityBonuses)) {
    if (!ABILITIES.includes(k as never)) errors.push(`caratteristica non valida: ${k}`);
    if (typeof v !== 'number') errors.push(`bonus non valido per ${k}`);
  }
  return errors;
}

export function validateFeatDef(f: Partial<FeatDef>): string[] {
  const errors: string[] = [];
  if (!isId(f.id)) errors.push('id non valido');
  if (!f.name) errors.push('name mancante');
  if (!f.description) errors.push('description mancante');
  if (!Array.isArray(f.effects) || f.effects.length === 0) errors.push('effects deve essere un array non vuoto');
  return errors;
}

export function validateEnemyDef(e: Partial<EnemyDef>): string[] {
  const errors: string[] = [];
  if (!isId(e.id)) errors.push('id non valido');
  if (!e.name) errors.push('name mancante');
  if (typeof e.hp !== 'number' || e.hp <= 0) errors.push('hp deve essere > 0');
  if (typeof e.ac !== 'number' || e.ac <= 0) errors.push('ac deve essere > 0');
  if (typeof e.speed !== 'number' || e.speed < 0) errors.push('speed deve essere >= 0');
  if (!Array.isArray(e.attacks) || e.attacks.length === 0) errors.push('attacks deve essere un array non vuoto');
  else for (const a of e.attacks) {
    if (!a?.name) errors.push('ogni attacco deve avere name');
    if (typeof a?.bonus !== 'number') errors.push(`attacco ${a?.name}: bonus mancante`);
    if (!a?.dice || !/^\d+d\d+(\s*[+-]\s*\d+)?$/.test(a.dice)) errors.push(`attacco ${a?.name}: dice non valido (es. 1d6+3)`);
  }
  if (e.abilities) for (const k of Object.keys(e.abilities)) {
    if (!ABILITIES.includes(k as never)) errors.push(`caratteristica non valida: ${k}`);
  }
  return errors;
}
