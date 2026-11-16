export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

export type AbilityScores = Record<Ability, number>;

export interface SkillDef {
  id: string;
  name: string;
  ability: Ability;
}

export const SKILLS: SkillDef[] = [
  { id: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
  { id: 'animalHandling', name: 'Animal Handling', ability: 'wis' },
  { id: 'arcana', name: 'Arcana', ability: 'int' },
  { id: 'athletics', name: 'Athletics', ability: 'str' },
  { id: 'deception', name: 'Deception', ability: 'cha' },
  { id: 'history', name: 'History', ability: 'int' },
  { id: 'insight', name: 'Insight', ability: 'wis' },
  { id: 'intimidation', name: 'Intimidation', ability: 'cha' },
  { id: 'investigation', name: 'Investigation', ability: 'int' },
  { id: 'medicine', name: 'Medicine', ability: 'wis' },
  { id: 'nature', name: 'Nature', ability: 'int' },
  { id: 'perception', name: 'Perception', ability: 'wis' },
  { id: 'performance', name: 'Performance', ability: 'cha' },
  { id: 'persuasion', name: 'Persuasion', ability: 'cha' },
  { id: 'religion', name: 'Religion', ability: 'int' },
  { id: 'sleightOfHand', name: 'Sleight of Hand', ability: 'dex' },
  { id: 'stealth', name: 'Stealth', ability: 'dex' },
  { id: 'survival', name: 'Survival', ability: 'wis' },
];

export type FeatureEffect =
  | { type: 'proficiency'; kind: 'skill' | 'weapon' | 'armor' | 'tool' | 'language' | 'savingThrow'; value: string }
  | { type: 'asi'; points: number }
  | { type: 'feat' }
  | { type: 'fightingStyle'; options: string[] }
  | { type: 'subclass'; options: string[] }
  | { type: 'spellcasting'; ability: Ability; prepare: boolean }
  | { type: 'cantripsKnown'; value: number }
  | { type: 'extraAttack'; count: number }
  | { type: 'unarmoredDefense'; ability: Ability }
  | { type: 'expertise'; choose: number; from: string[] }
  | { type: 'resource'; id: string; name: string; dice?: string; uses?: number; usesPerLevel?: number; shortRest?: boolean; longRest?: boolean }
  | { type: 'custom'; description: string; data?: Record<string, unknown> };

export interface Feature {
  id: string;
  name: string;
  description: string;
  source?: string;
  effects: FeatureEffect[];
}

export type CasterType = 'full' | 'half' | 'third' | 'pact';

export interface SpellcastingDef {
  ability: Ability;
  type: CasterType;
  /** arrotondamento per multiclasse: i mezzocaster arrotondano per difetto, l'artificer per eccesso */
  roundUp?: boolean;
  /** cantrip conosciuti per livello di classe (1-20) */
  cantrips: Record<number, number>;
  /** quanti incantesimi si conoscono: 'levelPlusMod', 'all' (lista completa) o numero fisso per livello */
  spellsKnown?: Record<number, number> | 'levelPlusMod' | 'all';
  /** preparation: true se la classe prepara gli incantesimi (chierico, druido, mago, paladino) */
  prepare: boolean;
  /** slot per livello di classe: slot[level][spellLevel-1] = numero di slot */
  slots: Record<number, number[]>;
}

export interface ClassDef {
  id: string;
  name: string;
  hitDie: 6 | 8 | 10 | 12;
  primaryAbility: Ability[];
  savingThrows: Ability[];
  armorProficiencies: string[];
  weaponProficiencies: string[];
  toolProficiencies: string[];
  skillChoices: { choose: number; from: string[] };
  spellcasting?: SpellcastingDef;
  /** feature per livello 1-20 */
  features: Record<number, Feature[]>;
  source: 'srd' | 'custom';
}

export interface SubclassDef {
  id: string;
  classId: string;
  name: string;
  features: Record<number, Feature[]>;
  source: 'srd' | 'custom';
}

export interface Trait {
  id: string;
  name: string;
  description: string;
}

export interface SubraceDef {
  id: string;
  name: string;
  abilityBonuses: Partial<Record<Ability, number>>;
  traits: Trait[];
}

export interface RaceDef {
  id: string;
  name: string;
  speed: number;
  abilityBonuses: Partial<Record<Ability, number>>;
  traits: Trait[];
  subraces: SubraceDef[];
  source: 'srd' | 'custom';
}

export type School =
  | 'abjuration' | 'conjuration' | 'divination' | 'enchantment'
  | 'evocation' | 'illusion' | 'necromancy' | 'transmutation';

export interface SpellDef {
  id: string;
  name: string;
  level: number;
  school: School;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  description: string;
  higherLevel?: string;
  ritual?: boolean;
  concentration?: boolean;
  damage?: string;
  /** classi SRD che possono averlo nella lista */
  classes?: string[];
  source: 'srd' | 'custom';
}

export type WeaponCategory = 'simple' | 'martial';
export type WeaponType = 'melee' | 'ranged';

export interface WeaponDef {
  id: string;
  name: string;
  category: WeaponCategory;
  type: WeaponType;
  damage: string;
  damageType: string;
  properties: string[];
  range?: string;
  weight: number;
  cost: { value: number; unit: 'cp' | 'sp' | 'gp' | 'pp' };
  bonus?: number;
  source: 'srd' | 'custom';
}

export type ArmorCategory = 'light' | 'medium' | 'heavy' | 'shield';

export interface ArmorDef {
  id: string;
  name: string;
  category: ArmorCategory;
  ac: number;
  /** bonus Des massimo applicabile (undefined = illimitato) */
  maxDex?: number;
  strengthRequirement?: number;
  stealthDisadvantage?: boolean;
  weight: number;
  cost: { value: number; unit: 'cp' | 'sp' | 'gp' | 'pp' };
  bonus?: number;
  source: 'srd' | 'custom';
}

export interface FeatDef {
  id: string;
  name: string;
  description: string;
  effects: FeatureEffect[];
  source: 'srd' | 'custom';
}

export type Currency = { cp: number; sp: number; ep: number; gp: number; pp: number };

export type ItemKind = 'weapon' | 'armor' | 'shield' | 'gear' | 'treasure' | 'custom';

export interface InventoryItem {
  id: string;
  name: string;
  kind: ItemKind;
  quantity: number;
  weight: number;
  equipped: boolean;
  /** riferimento a WeaponDef / ArmorDef / SpellDef ecc. */
  refId?: string;
  magic: boolean;
  attuned: boolean;
  notes?: string;
}

export interface ClassLevel {
  classId: string;
  level: number;
  /** hp tirati per dado vita di questa classe (valori 1..hitDie) */
  hitDiceRolled: number[];
  subclassId?: string;
}

export interface Proficiencies {
  skills: string[];
  expertise: string[];
  weapons: string[];
  armors: string[];
  tools: string[];
  languages: string[];
}

export interface SpellSlotState {
  total: number;
  used: number;
}

export interface Character {
  id: string;
  name: string;
  raceId: string;
  subraceId?: string;
  background?: string;
  alignment?: string;
  xp: number;
  inspiration: boolean;
  abilityScores: AbilityScores;
  classLevels: ClassLevel[];
  proficiency: Proficiencies;
  fightingStyles: string[];
  feats: string[];
  features: string[];
  spellsKnown: string[];
  spellsPrepared: string[];
  spellSlots: Record<number, SpellSlotState>;
  concentrationSpellId?: string;
  inventory: InventoryItem[];
  currency: Currency;
  hp: { current: number; temp: number };
  notes: string;
  createdAt: string;
  updatedAt: string;
}
