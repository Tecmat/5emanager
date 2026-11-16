import { FULL_CASTER_SLOTS, createRegistry, loadData } from '@dnd5e/core';
import type { ClassDef, Registry, SrdData } from '@dnd5e/core';

import fighter from '../data/classes/fighter.json';
import wizard from '../data/classes/wizard.json';
import rogue from '../data/classes/rogue.json';
import cleric from '../data/classes/cleric.json';
import paladin from '../data/classes/paladin.json';
import subclasses from '../data/subclasses.json';
import races from '../data/races.json';
import spellsA from '../data/spells-a.json';
import spellsB from '../data/spells-b.json';
import weapons from '../data/weapons.json';
import armors from '../data/armors.json';
import feats from '../data/feats.json';
import fightingStyles from '../data/fighting-styles.json';

const classList = [fighter, wizard, rogue, cleric, paladin] as unknown as ClassDef[];

// i full caster ereditano la tabella slot standard del PHB
for (const cls of classList) {
  if (cls.spellcasting && cls.spellcasting.type === 'full') {
    const slots: Record<number, number[]> = {};
    for (let lvl = 1; lvl <= 20; lvl++) slots[lvl] = FULL_CASTER_SLOTS[lvl - 1];
    cls.spellcasting.slots = slots;
  }
}

export const SRD_DATA: SrdData = {
  classes: classList,
  subclasses: subclasses as unknown as SrdData['subclasses'],
  races: races as unknown as SrdData['races'],
  spells: [...spellsA, ...spellsB] as unknown as SrdData['spells'],
  weapons: weapons as unknown as SrdData['weapons'],
  armors: armors as unknown as SrdData['armors'],
  feats: feats as unknown as SrdData['feats'],
  fightingStyles: fightingStyles as unknown as SrdData['fightingStyles'],
};

export function createSrdRegistry(): Registry {
  const reg = createRegistry();
  loadData(reg, SRD_DATA);
  return reg;
}
