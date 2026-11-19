import { FULL_CASTER_SLOTS, createRegistry, loadData } from '@dnd5e/core';
import type { ClassDef, Registry, SrdData } from '@dnd5e/core';

import fighter from '../data/classes/fighter.json';
import wizard from '../data/classes/wizard.json';
import rogue from '../data/classes/rogue.json';
import cleric from '../data/classes/cleric.json';
import paladin from '../data/classes/paladin.json';
import barbarian from '../data/classes/barbarian.json';
import bard from '../data/classes/bard.json';
import druid from '../data/classes/druid.json';
import monk from '../data/classes/monk.json';
import ranger from '../data/classes/ranger.json';
import sorcerer from '../data/classes/sorcerer.json';
import warlock from '../data/classes/warlock.json';
import subclasses from '../data/subclasses.json';
import subclassesB from '../data/subclasses-b.json';
import races from '../data/races.json';
import spellsA from '../data/spells-a.json';
import spellsB from '../data/spells-b.json';
import weapons from '../data/weapons.json';
import armors from '../data/armors.json';
import feats from '../data/feats.json';
import fightingStyles from '../data/fighting-styles.json';
import enemies from '../data/enemies.json';
import random from '../data/random.json';
import type { RandomData } from '@dnd5e/core';

const classList = [fighter, wizard, rogue, cleric, paladin, barbarian, bard, druid, monk, ranger, sorcerer, warlock] as unknown as ClassDef[];

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
  subclasses: [...subclasses, ...subclassesB] as unknown as SrdData['subclasses'],
  races: races as unknown as SrdData['races'],
  spells: [...spellsA, ...spellsB] as unknown as SrdData['spells'],
  weapons: weapons as unknown as SrdData['weapons'],
  armors: armors as unknown as SrdData['armors'],
  feats: feats as unknown as SrdData['feats'],
  fightingStyles: fightingStyles as unknown as SrdData['fightingStyles'],
  enemies: enemies as unknown as SrdData['enemies'],
};

export function createSrdRegistry(): Registry {
  const reg = createRegistry();
  loadData(reg, SRD_DATA);
  return reg;
}

/** tabelle del generatore casuale (nomi, incontri, tesori) per il master */
export const RANDOM_DATA = random as unknown as RandomData;
