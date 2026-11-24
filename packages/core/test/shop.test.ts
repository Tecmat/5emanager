import { describe, expect, it } from 'vitest';
import {
  addCurrency,
  addItem,
  applyCampaignAction,
  buyItem,
  copperToCurrency,
  craftItem,
  createCharacter,
  currencyToCopper,
  damageCombatant,
  DEFAULT_HOUSE_RULES,
  DEFAULT_STATS,
  healCombatant,
  missingIngredients,
  nextTurn,
  payCopper,
  randomDungeon,
  type Campaign,
  type Character,
  type CraftingRecipe,
  type ShopItem,
} from '../src/index.js';
import { createSrdRegistry, DUNGEON_DATA } from '@dnd5e/data-srd';

const reg = createSrdRegistry();

function makeChar(): Character {
  const res = createCharacter({
    name: 'Test', raceId: 'human', subraceId: 'human-standard', classId: 'fighter',
    abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 8 },
  }, reg);
  if (!res.character) throw new Error(res.errors.join(','));
  return res.character;
}

/** rng deterministico (mulberry32) per testare il generatore */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ration: ShopItem = { id: 'ration', name: 'Razione di viaggio', kind: 'consumable', valueGp: 5, weight: 2 };
const potion: ShopItem = { id: 'potion-heal', name: 'Pozione di guarigione', kind: 'consumable', valueGp: 50, weight: 0.5, magic: true, rarity: 'common' };

const recipe: CraftingRecipe = {
  id: 'craft-potion',
  name: 'Pozione di guarigione',
  result: { name: 'Pozione di guarigione', kind: 'consumable', valueGp: 50, weight: 0.5, magic: true },
  ingredients: [{ name: 'Erba curativa', quantity: 2 }, { name: 'Acqua santa', quantity: 1 }],
  costGp: 25,
};

describe('valuta: copperToCurrency e payCopper (resto)', () => {
  it('converte il rame nelle denominazioni giuste', () => {
    expect(copperToCurrency(1234)).toEqual({ pp: 1, gp: 2, ep: 0, sp: 3, cp: 4 });
    expect(copperToCurrency(0)).toEqual({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
  });

  it('paga esatto usando le monete giuste', () => {
    let c = makeChar();
    c = addCurrency(c, { gp: 10 });
    const r = payCopper(c, 500); // 5 mo
    expect(r.error).toBeUndefined();
    expect(r.character.currency.gp).toBe(5);
    expect(currencyToCopper(r.change)).toBe(0);
  });

  it('rompe una moneta grande e restituisce il resto', () => {
    let c = makeChar();
    c = addCurrency(c, { pp: 1 }); // 1000 rame
    const r = payCopper(c, 300); // 3 mo -> resto 700 rame = 7 mo
    expect(r.error).toBeUndefined();
    expect(currencyToCopper(r.character.currency)).toBe(0);
    expect(currencyToCopper(r.change)).toBe(700);
    expect(r.change.gp).toBe(7);
  });

  it('rifiuta se i fondi non bastano', () => {
    let c = makeChar();
    c = addCurrency(c, { sp: 5 }); // 50 rame
    const r = payCopper(c, 100);
    expect(r.error).toMatch(/Fondi insufficienti/);
    expect(r.character).toBe(c);
  });
});

describe('negozio: buyItem', () => {
  it('scala il costo e aggiunge l\'oggetto (nuovo)', () => {
    let c = makeChar();
    c = addCurrency(c, { gp: 100 });
    const r = buyItem(c, ration, 2); // 10 mo
    expect(r.error).toBeUndefined();
    expect(r.spentGp).toBe(10);
    expect(r.character.currency.gp).toBe(90);
    const it = r.character.inventory.find((i) => i.name === 'Razione di viaggio');
    expect(it).toBeDefined();
    expect(it!.quantity).toBe(2);
    expect(it!.kind).toBe('consumable');
    expect(it!.valueGp).toBe(5);
  });

  it('accoda la quantit\u00e0 se l\'oggetto esiste gi\u00e0 (stesso nome+tipo)', () => {
    let c = makeChar();
    c = addCurrency(c, { gp: 100 });
    c = addItem(c, { name: 'Razione di viaggio', kind: 'consumable', quantity: 3, weight: 2, equipped: false, magic: false, attuned: false }).character;
    const r = buyItem(c, ration, 4);
    expect(r.character.inventory.filter((i) => i.name === 'Razione di viaggio')).toHaveLength(1);
    expect(r.character.inventory[0].quantity).toBe(7);
  });

  it('rifiuta se non bastano i soldi e non tocca nulla', () => {
    let c = makeChar();
    c = addCurrency(c, { gp: 10 });
    const r = buyItem(c, potion, 1); // 50 mo
    expect(r.error).toMatch(/Fondi insufficienti/);
    expect(r.character.currency.gp).toBe(10);
    expect(r.character.inventory).toHaveLength(0);
  });

  it('quantit\u00e0 non valida', () => {
    const r = buyItem(makeChar(), ration, 0);
    expect(r.error).toMatch(/Quantit/);
  });
});

describe('crafting: missingIngredients e craftItem', () => {
  it('segnala gli ingredienti mancanti (contati per nome)', () => {
    let c = makeChar();
    c = addItem(c, { name: 'Erba curativa', kind: 'gear', quantity: 1, weight: 0, equipped: false, magic: false, attuned: false }).character;
    const missing = missingIngredients(c, recipe);
    expect(missing).toEqual([{ name: 'Erba curativa', quantity: 1 }, { name: 'Acqua santa', quantity: 1 }]);
  });

  it('consuma gli ingredienti, scala il costo e aggiunge il risultato', () => {
    let c = makeChar();
    c = addCurrency(c, { gp: 100 });
    c = addItem(c, { name: 'Erba curativa', kind: 'gear', quantity: 3, weight: 0, equipped: false, magic: false, attuned: false }).character;
    c = addItem(c, { name: 'Acqua santa', kind: 'gear', quantity: 1, weight: 0, equipped: false, magic: false, attuned: false }).character;
    const r = craftItem(c, recipe);
    expect(r.error).toBeUndefined();
    expect(r.character.currency.gp).toBe(75); // -25 mo di costo
    const erba = r.character.inventory.find((i) => i.name === 'Erba curativa');
    expect(erba!.quantity).toBe(1); // ne consuma 2 su 3
    expect(r.character.inventory.find((i) => i.name === 'Acqua santa')).toBeUndefined(); // 1 su 1 -> rimosso
    const poz = r.character.inventory.find((i) => i.name === 'Pozione di guarigione');
    expect(poz).toBeDefined();
    expect(poz!.magic).toBe(true);
    expect(poz!.kind).toBe('consumable');
  });

  it('rifiuta senza ingredienti (e non scala soldi)', () => {
    let c = makeChar();
    c = addCurrency(c, { gp: 100 });
    const r = craftItem(c, recipe);
    expect(r.error).toMatch(/Ingredienti mancanti/);
    expect(r.character.currency.gp).toBe(100);
  });

  it('rifiuta se mancano i soldi per il costo', () => {
    let c = makeChar();
    c = addItem(c, { name: 'Erba curativa', kind: 'gear', quantity: 2, weight: 0, equipped: false, magic: false, attuned: false }).character;
    c = addItem(c, { name: 'Acqua santa', kind: 'gear', quantity: 1, weight: 0, equipped: false, magic: false, attuned: false }).character;
    const r = craftItem(c, recipe); // 0 mo, costo 25
    expect(r.error).toMatch(/Fondi insufficienti/);
  });
});

describe('generatore di dungeon: randomDungeon', () => {
  it('deterministico con rng seeded e numero di stanze richiesto', () => {
    const d1 = randomDungeon(DUNGEON_DATA, 8, seededRng(42));
    const d2 = randomDungeon(DUNGEON_DATA, 8, seededRng(42));
    expect(d1).toEqual(d2);
    expect(d1.rooms).toHaveLength(8);
    expect(d1.name.length).toBeGreaterThan(2);
    for (const [i, r] of d1.rooms.entries()) {
      expect(r.n).toBe(i + 1);
      expect(r.type).toBeTruthy();
      expect(r.desc).toBeTruthy();
    }
  });

  it('trappole/mostri/tesori sono opzionali e dai tipi della tabella', () => {
    const d = randomDungeon(DUNGEON_DATA, 20, seededRng(7));
    for (const r of d.rooms) {
      if (r.trap) expect(DUNGEON_DATA.traps).toContain(r.trap);
      if (r.monster) expect(DUNGEON_DATA.monsters).toContain(r.monster);
      if (r.treasure) expect(r.treasure.text).toBeTruthy();
    }
  });
});

describe('statistiche di campagna', () => {
  const camp = (): Campaign => ({
    id: 'c1',
    name: 'Test',
    passwordHash: 'x',
    houseRules: { ...DEFAULT_HOUSE_RULES },
    custom: {},
    players: [
      { id: 'm', name: 'Master', role: 'master' },
      { id: 'p1', name: 'Eroe', role: 'player' },
    ],
    characters: { p1: { ...makeChar(), id: 'ch1' } },
    combat: null,
    groupInventory: [],
    groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: '',
    chat: [],
    stats: { ...DEFAULT_STATS },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('attack conta attacchi/danni/uccisioni; damage/heal aggiornano i contatori; nextTurn i round', () => {
    let c = camp();
    c.combat = {
      combatants: [
        { id: 'ch1', name: 'Eroe', isPlayer: true, hp: 10, maxHp: 10, initiative: 20, conditions: [], conditionRounds: {}, attacks: [] },
        { id: 'e1', name: 'Goblin', isPlayer: false, hp: 7, maxHp: 7, initiative: 5, conditions: [], conditionRounds: {} },
      ],
      round: 1,
      turnIndex: 0,
      log: [],
    } as never;
    // il master colpisce il goblin: +1 attacco, danni Conteggiati
    const [c1, err1] = applyCampaignAction(c, 'm', reg, { kind: 'attack', targetId: 'e1', attackIndex: 0 });
    expect(err1).toBeUndefined();
    expect(c1.stats.attacks).toBe(1);
    expect(c1.stats.damageDealt).toBeGreaterThanOrEqual(0);
    // danno diretto sul PG: damageTaken; poi cura: healed
    const [c2] = applyCampaignAction(c1, 'm', reg, { kind: 'damage', targetId: 'ch1', amount: 4 });
    expect(c2.stats.damageTaken).toBe(4);
    const [c3] = applyCampaignAction(c2, 'm', reg, { kind: 'heal', targetId: 'ch1', amount: 3 });
    expect(c3.stats.healed).toBe(3);
    // nextTurn: i round si contano quando il giro ricomincia (2 combattenti -> 2 turni)
    const [c4] = applyCampaignAction(c3, 'm', reg, { kind: 'nextTurn' });
    expect(c4.combat!.round).toBe(1);
    expect(c4.stats.rounds).toBe(1);
    const [c5] = applyCampaignAction(c4, 'm', reg, { kind: 'nextTurn' });
    expect(c5.combat!.round).toBe(2);
    expect(c5.stats.rounds).toBe(2);
  });

  it('uccisione: a 0 PF conta kill (damage sul mostro fino a 0)', () => {
    let c = camp();
    c.combat = {
      combatants: [
        { id: 'ch1', name: 'Eroe', isPlayer: true, hp: 10, maxHp: 10, initiative: 20, conditions: [], conditionRounds: {}, attacks: [] },
        { id: 'e1', name: 'Goblin', isPlayer: false, hp: 3, maxHp: 7, initiative: 5, conditions: [], conditionRounds: {} },
      ],
      round: 1,
      turnIndex: 0,
      log: [],
    } as never;
    const [c1] = applyCampaignAction(c, 'm', reg, { kind: 'damage', targetId: 'e1', amount: 10 });
    expect(c1.stats.kills).toBe(1);
    expect(c1.stats.damageTaken).toBe(3); // solo i danni effettivi (clamp a 0)
  });

  it('damageCombatant/healCombatant/nextTurnCombatant restano coerenti con le stats (livello rules)', () => {
    const st = { combatants: [{ id: 'e1', name: 'G', isPlayer: false, hp: 10, maxHp: 10, conditions: [], conditionRounds: {} }], round: 1, turnIndex: 0, log: [] } as never;
    const d = damageCombatant(st, 'e1', 4);
    expect(d.combatants[0].hp).toBe(6);
    const h = healCombatant(d, 'e1', 2);
    expect(h.combatants[0].hp).toBe(8);
    const n = nextTurn(h);
    expect(n.turnIndex).toBe(0); // un solo combattente: il giro ricomincia
    expect(n.round).toBe(2); // e il round avanza
  });
});
