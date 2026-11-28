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
  | { type: 'resource'; id: string; name: string; dice?: string; uses?: number; usesPerLevel?: number; usesTable?: Record<number, number>; shortRest?: boolean; longRest?: boolean }
  | { type: 'custom'; description: string; data?: Record<string, unknown> }
  /** mini-DSL degli effetti, es. "+2 CA", "advantage: saves vs magic", "+1d6 fire damage", "proficiency: skill stealth" (interpretato da rules/effects.ts) */
  | { type: 'effect'; text: string };

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
  /** prerequisiti per il multiclasse (PHB): caratteristica minima richiesta (tutte) */
  multiclassPrereq?: Partial<Record<Ability, number>>;
  /** prerequisiti multiclasse in alternativa (almeno uno richiesto, es. guerriero: Str OPPURE Dex 13) */
  multiclassPrereqAny?: Partial<Record<Ability, number>>;
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
  /** se il componente materiale (M) viene consumato dal lancio (default: true se c'è M, a meno che la descrizione non dica il contrario) */
  materialConsumed?: boolean;
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

export interface AttackDef {
  name: string;
  bonus: number;
  dice: string;
  type?: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  ac: number;
  speed: number;
  attacks: AttackDef[];
  cr?: string;
  abilities?: Partial<Record<Ability, number>>;
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

export type ItemKind = 'weapon' | 'armor' | 'shield' | 'gear' | 'consumable' | 'ammo' | 'scroll' | 'treasure' | 'custom';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'veryRare' | 'legendary';

/** oggetto acquistabile in un negozio (tabelle shop di data-srd) */
export interface ShopItem {
  id: string;
  name: string;
  kind: ItemKind;
  /** prezzo di 1 unità in monete d'oro */
  valueGp: number;
  weight: number;
  magic?: boolean;
  rarity?: ItemRarity;
}

/** ingrediente di una ricetta di crafting (contato per nome sull'inventario) */
export interface CraftingIngredient {
  name: string;
  quantity: number;
}

/** ricetta di crafting: consuma ingredienti + oro e produce un oggetto */
export interface CraftingRecipe {
  id: string;
  name: string;
  result: Omit<InventoryItem, 'id' | 'quantity' | 'equipped' | 'attuned' | 'magic'> & { quantity?: number; magic?: boolean };
  ingredients: CraftingIngredient[];
  /** costo aggiuntivo in monete d'oro (artigianato) */
  costGp: number;
}

/** slot di equipaggiamento standard: un solo oggetto equipaggiato per slot (le mani possono avere arma/scudo) */
export type EquipSlot = 'head' | 'amulet' | 'cloak' | 'armor' | 'gloves' | 'belt' | 'boots' | 'ring1' | 'ring2' | 'shield' | 'hand1' | 'hand2';

export interface InventoryItem {
  id: string;
  name: string;
  kind: ItemKind;
  quantity: number;
  weight: number;
  equipped: boolean;
  /** slot occupato quando equipaggiato (auto: armatura->armor, scudo->shield, arma->mano libera) */
  slot?: EquipSlot;
  /** riferimento a WeaponDef / ArmorDef / SpellDef ecc. */
  refId?: string;
  magic: boolean;
  attuned: boolean;
  notes?: string;
  /** cariche/usi dell'oggetto (pozioni, bacchette, munizioni...) */
  charges?: { current: number; max: number };
  /** id del contenitore che contiene questo oggetto (zaino dentro zaino) */
  containerId?: string;
  /** rarità dell'oggetto (filtri e tesoreria) */
  rarity?: ItemRarity;
  /** valore in monete d'oro dell'unità (per vendere/tesoro) */
  valueGp?: number;
  /** se l'oggetto lancia un incantesimo spendendo una carica (pergamene, bacchette...) */
  spellId?: string;
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

/** selettore house-rules: ogni flag permette di eludere la relativa regola */
export interface HouseRules {
  bypassSpellLimit: boolean;
  bypassAsiCap: boolean;
  bypassAttunementLimit: boolean;
  bypassXpCheck: boolean;
  bypassLevelCap: boolean;
  bypassPrereq: boolean;
}

export const DEFAULT_HOUSE_RULES: HouseRules = {
  bypassSpellLimit: false,
  bypassAsiCap: false,
  bypassAttunementLimit: false,
  bypassXpCheck: false,
  bypassLevelCap: false,
  bypassPrereq: false,
};

/** la parte "anima" del PG: testo libero di flavor (D&D 5e: aspetto, personalità, ideali, legami, difetti, storia) */
export interface CharacterFlavor {
  appearance?: string;
  personalityTraits?: string;
  ideals?: string;
  bonds?: string;
  flaws?: string;
  backstory?: string;
}

export interface Character {
  id: string;
  houseRules: HouseRules;
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
  /** ritratto del PG come data URL (immagine ridimensionata) */
  portrait?: string;
  /** anima del PG: campi flavor opzionali (retrocompatibile: assente nelle schede vecchie) */
  flavor?: CharacterFlavor;
  /** tiri della morte quando a 0 PF */
  deathSaves: { successes: number; failures: number };
  /** condizioni attive (es. 'avvelenato', 'invisibile') */
  conditions: string[];
  /** diario di sessione: eventi automatici (XP, danni, level-up...) + note manuali */
  journal: { at: string; text: string }[];
  /** incantesimi preferiti (⭐) mostrati con filtro in tab Incantesimi */
  favoriteSpells: string[];
  /** livello di esaurimento 0-6 (6 = morte) */
  exhaustion: number;
  /** incantesimi preparati divisi per classe (multiclasse): classId -> spellId[] */
  spellsPreparedByClass: Record<string, string[]>;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
