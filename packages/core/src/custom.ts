import type { ArmorDef, ClassDef, EnemyDef, FeatDef, RaceDef, SpellDef, SubclassDef, WeaponDef } from './types.js';
import type { Registry } from './registry.js';
import {
  validateArmorDef,
  validateClassDef,
  validateEnemyDef,
  validateFeatDef,
  validateRaceDef,
  validateSpellDef,
  validateSubclassDef,
  validateWeaponDef,
} from './validate.js';

export interface AddResult<T> {
  ok: boolean;
  errors: string[];
  value?: T;
}

function register<T extends { id: string }>(map: Map<string, T>, item: T, errors: string[], label: string): AddResult<T> {
  if (errors.length > 0) return { ok: false, errors };
  if (map.has(item.id)) return { ok: false, errors: [`${label} con id '${item.id}' esiste già`] };
  map.set(item.id, item);
  return { ok: true, errors: [], value: item };
}

export function addCustomSpell(reg: Registry, spell: SpellDef): AddResult<SpellDef> {
  const s = { ...spell, source: 'custom' as const };
  return register(reg.spells, s, validateSpellDef(s), 'Incantesimo');
}

export function addCustomWeapon(reg: Registry, weapon: WeaponDef): AddResult<WeaponDef> {
  const w = { ...weapon, source: 'custom' as const };
  return register(reg.weapons, w, validateWeaponDef(w), 'Arma');
}

export function addCustomArmor(reg: Registry, armor: ArmorDef): AddResult<ArmorDef> {
  const a = { ...armor, source: 'custom' as const };
  return register(reg.armors, a, validateArmorDef(a), 'Armatura');
}

export function addCustomClass(reg: Registry, cls: ClassDef): AddResult<ClassDef> {
  const c = { ...cls, source: 'custom' as const };
  return register(reg.classes, c, validateClassDef(c), 'Classe');
}

export function addCustomSubclass(reg: Registry, sub: SubclassDef): AddResult<SubclassDef> {
  const s = { ...sub, source: 'custom' as const };
  const ids = new Set(reg.classes.keys());
  return register(reg.subclasses, s, validateSubclassDef(s, ids), 'Archetipo');
}

export function addCustomRace(reg: Registry, race: RaceDef): AddResult<RaceDef> {
  const r = { ...race, source: 'custom' as const };
  return register(reg.races, r, validateRaceDef(r), 'Razza');
}

export function addCustomFeat(reg: Registry, feat: FeatDef): AddResult<FeatDef> {
  const f = { ...feat, source: 'custom' as const };
  return register(reg.feats, f, validateFeatDef(f), 'Talento');
}

export function addCustomEnemy(reg: Registry, enemy: EnemyDef): AddResult<EnemyDef> {
  const e = { ...enemy, source: 'custom' as const };
  return register(reg.enemies, e, validateEnemyDef(e), 'Nemico');
}
