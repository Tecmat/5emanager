import type {
  ArmorDef,
  ClassDef,
  FeatDef,
  RaceDef,
  SpellDef,
  SubclassDef,
  WeaponDef,
} from './types.js';

export interface FightingStyleDef {
  id: string;
  name: string;
  description: string;
}

export interface Registry {
  classes: Map<string, ClassDef>;
  subclasses: Map<string, SubclassDef>;
  races: Map<string, RaceDef>;
  spells: Map<string, SpellDef>;
  weapons: Map<string, WeaponDef>;
  armors: Map<string, ArmorDef>;
  feats: Map<string, FeatDef>;
  fightingStyles: Map<string, FightingStyleDef>;
}

export function createRegistry(): Registry {
  return {
    classes: new Map(),
    subclasses: new Map(),
    races: new Map(),
    spells: new Map(),
    weapons: new Map(),
    armors: new Map(),
    feats: new Map(),
    fightingStyles: new Map(),
  };
}

export interface SrdData {
  classes: ClassDef[];
  subclasses: SubclassDef[];
  races: RaceDef[];
  spells: SpellDef[];
  weapons: WeaponDef[];
  armors: ArmorDef[];
  feats: FeatDef[];
  fightingStyles: FightingStyleDef[];
}

export function loadData(reg: Registry, data: SrdData): void {
  for (const c of data.classes) reg.classes.set(c.id, c);
  for (const s of data.subclasses) reg.subclasses.set(s.id, s);
  for (const r of data.races) reg.races.set(r.id, r);
  for (const s of data.spells) reg.spells.set(s.id, s);
  for (const w of data.weapons) reg.weapons.set(w.id, w);
  for (const a of data.armors) reg.armors.set(a.id, a);
  for (const f of data.feats) reg.feats.set(f.id, f);
  for (const f of data.fightingStyles) reg.fightingStyles.set(f.id, f);
}

/** esporta solo i contenuti custom (source === 'custom') per salvataggio/backup */
export function exportCustomContent(reg: Registry): SrdData {
  return {
    classes: [...reg.classes.values()].filter((c) => c.source === 'custom'),
    subclasses: [...reg.subclasses.values()].filter((s) => s.source === 'custom'),
    races: [...reg.races.values()].filter((r) => r.source === 'custom'),
    spells: [...reg.spells.values()].filter((s) => s.source === 'custom'),
    weapons: [...reg.weapons.values()].filter((w) => w.source === 'custom'),
    armors: [...reg.armors.values()].filter((a) => a.source === 'custom'),
    feats: [...reg.feats.values()].filter((f) => f.source === 'custom'),
    fightingStyles: [...reg.fightingStyles.values()],
  };
}

export function exportAll(reg: Registry): SrdData {
  return {
    classes: [...reg.classes.values()],
    subclasses: [...reg.subclasses.values()],
    races: [...reg.races.values()],
    spells: [...reg.spells.values()],
    weapons: [...reg.weapons.values()],
    armors: [...reg.armors.values()],
    feats: [...reg.feats.values()],
    fightingStyles: [...reg.fightingStyles.values()],
  };
}
