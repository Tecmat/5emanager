import { describe, expect, it } from 'vitest';
import {
  applyCampaignAction,
  castItemSpell,
  castSpell,
  clearTemplate,
  createCharacter,
  damageCombatant,
  migrateCampaign,
  rollEncounter,
  rollTreasure,
  randomName,
  sellItem,
  setTemplate,
  startCombat,
  toggleFavoriteSpell,
  totalTreasureGp,
  upcastExtraDice,
  spellDamagePreview,
  addItem,
  addSpellKnown,
  type Campaign,
  type Character,
  type PlayerInfo,
} from '../src/index.js';
import { createSrdRegistry, RANDOM_DATA } from '@dnd5e/data-srd';

const reg = createSrdRegistry();

function makeChar(classId = 'wizard'): Character {
  const res = createCharacter({
    name: 'Test', raceId: 'human', subraceId: 'human-standard', classId,
    abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
  }, reg);
  if (!res.character) throw new Error(res.errors.join(','));
  return res.character;
}

function makeCampaign(): Campaign {
  return migrateCampaign({
    id: 'test1234',
    name: 'Test',
    passwordHash: 'x',
    houseRules: {} as never,
    custom: {},
    players: [
      { id: 'm1', name: 'Master', role: 'master' },
      { id: 'p1', name: 'P1', role: 'player' },
    ] as PlayerInfo[],
    characters: { m1: makeChar('fighter'), p1: makeChar('rogue') },
    combat: null,
    createdAt: '', updatedAt: '',
  } as unknown as Campaign);
}

describe('P1: upcast del danno', () => {
  it('upcastExtraDiceParsing da higherLevel (+1d6 per slot superiore)', () => {
    const fireball = reg.spells.get('fireball')!;
    expect(fireball.higherLevel).toBeTruthy();
    expect(upcastExtraDice(fireball, 3)).toBeNull(); // stesso livello
    expect(upcastExtraDice(fireball, 5)).toBe('2d6'); // 2 slot sopra
    const pre = spellDamagePreview(fireball, 5);
    expect(pre.base).toBe('8d6');
    expect(pre.extra).toBe('2d6');
  });

  it('il diario registra upcast nel lancio', () => {
    let c = makeChar('wizard');
    c = { ...c, spellSlots: { ...c.spellSlots, 5: { total: 2, used: 0 } } }; // slot 5° prima di imparare
    const r = addSpellKnown(c, 'fireball', reg);
    expect(r.error).toBeUndefined();
    c = r.character;
    const before = Object.values(c.spellSlots).reduce((s, v) => s + v.used, 0);
    const cast = castSpell(c, 'fireball', 5, reg);
    expect(cast.error).toBeUndefined();
    expect(Object.values(cast.character.spellSlots).reduce((s, v) => s + v.used, 0)).toBe(before + 1);
    const last = cast.character.journal[cast.character.journal.length - 1].text;
    expect(last).toContain('upcast');
    expect(last).toContain('2d6');
  });
});

describe('P1: preferiti incantesimi', () => {
  it('toggle on/off', () => {
    let c = makeChar();
    c = toggleFavoriteSpell(c, 'fireball');
    expect(c.favoriteSpells).toContain('fireball');
    c = toggleFavoriteSpell(c, 'fireball');
    expect(c.favoriteSpells).not.toContain('fireball');
  });
});

describe('P2: oggetti che lanciano incantesimi (pergamene/bacchette)', () => {
  it('castItemSpell consuma 1 carica, non usa slot, imposta concentration', () => {
    let c = makeChar('wizard');
    c = { ...c, spellSlots: { ...c.spellSlots, 3: { total: 1, used: 0 } } }; // slot 3° per haste
    c = addSpellKnown(c, 'haste', reg).character;
    c = addItem(c, { name: 'Pergamena di Velocità', kind: 'treasure', quantity: 1, weight: 0, equipped: false, magic: true, attuned: false, spellId: 'haste', charges: { current: 1, max: 1 } }).character;
    const item = c.inventory[0];
    const slotsBefore = JSON.stringify(c.spellSlots);
    const r = castItemSpell(c, item.id, reg);
    expect(r.error).toBeUndefined();
    expect(JSON.stringify(r.character.spellSlots)).toBe(slotsBefore); // nessuno slot consumato
    expect(r.character.inventory.find((i) => i.id === item.id)?.charges?.current).toBe(0); // carica consumata
    expect(r.character.concentrationSpellId).toBe('haste'); // haste richiede concentration
    expect(r.character.journal[r.character.journal.length - 1].text).toContain('Pergamena di Velocità');
  });

  it('senza cariche dà errore', () => {
    let c = makeChar('wizard');
    c = addItem(c, { name: 'Bacchetta vuota', kind: 'treasure', quantity: 1, weight: 0, equipped: false, magic: true, attuned: false, spellId: 'magic-missile', charges: { current: 0, max: 7 } }).character;
    const r = castItemSpell(c, c.inventory[0].id, reg);
    expect(r.error).toBeTruthy();
  });
});

describe('P2: vendita e tesoreria inventario', () => {
  it('sellItem decrementa la quantità e aggiunge mo; a qty 1 rimuove', () => {
    let c = makeChar('fighter');
    c = addItem(c, { name: 'Pozione', kind: 'gear', quantity: 3, weight: 0.5, equipped: false, magic: false, attuned: false, valueGp: 50 }).character;
    const id = c.inventory[0].id;
    const gpBefore = c.currency.gp;
    let r = sellItem(c, id);
    expect(r.error).toBeUndefined();
    expect(r.gainedGp).toBe(50);
    expect(r.character.currency.gp).toBe(gpBefore + 50);
    expect(r.character.inventory[0].quantity).toBe(2);
    r = sellItem(r.character, id);
    r = sellItem(r.character, id);
    expect(r.character.inventory.find((i) => i.id === id)).toBeUndefined();
  });

  it('senza valueGp dà errore; totalTreasureGp somma valuta + oggetti', () => {
    let c = makeChar('fighter');
    c = addItem(c, { name: 'Cianfrusaglia', kind: 'treasure', quantity: 1, weight: 1, equipped: false, magic: false, attuned: false }).character;
    expect(sellItem(c, c.inventory[0].id).error).toBeTruthy();
    c = addItem(c, { name: 'Gemma', kind: 'treasure', quantity: 2, weight: 0, equipped: false, magic: false, attuned: false, valueGp: 100 }).character;
    c = { ...c, currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 } };
    expect(totalTreasureGp(c)).toBe(10 + 200);
  });
});

describe('P2: template aree e save di concentrazione in combattimento', () => {
  it('setTemplate/clearTemplate e log', () => {
    const c = makeChar('wizard');
    let s = startCombat(c, reg);
    s = setTemplate(s, { shape: 'cone', sizeFt: 15, originId: c.id, label: 'Cono di 15 ft' });
    expect(s.template?.shape).toBe('cone');
    expect(s.log.some((l) => l.includes('Cono'))).toBe(true);
    s = clearTemplate(s);
    expect(s.template).toBeUndefined();
  });

  it('damageCombatant avvisa il TS di concentrazione', () => {
    const c = makeChar('wizard');
    let s = startCombat(c, reg);
    s = { ...s, combatants: s.combatants.map((cb) => (cb.id === c.id ? { ...cb, concentrating: 'haste' } : cb)) };
    s = damageCombatant(s, c.id, 30);
    const last = s.log[s.log.length - 1];
    expect(last).toContain('CD 15');
    expect(last).toContain('haste');
    // danno piccolo -> CD minimo 10
    s = damageCombatant(s, c.id, 4);
    expect(s.log[s.log.length - 1]).toContain('CD 10');
  });
});

describe('P1/P2: campagna — gruppo, XP party, note, template via azioni', () => {
  it('migrateCampaign riempie i campi nuovi', () => {
    const raw = { id: 'x', name: 'n', passwordHash: '', houseRules: {}, custom: {}, players: [], characters: {}, combat: null, createdAt: '', updatedAt: '' } as unknown as Campaign;
    const m = migrateCampaign(raw);
    expect(m.groupInventory).toEqual([]);
    expect(m.groupCurrency.gp).toBe(0);
    expect(m.notes).toBe('');
  });

  it('groupAddItem (chiunque) / groupRemoveItem e groupGiveItem (solo master)', () => {
    let c = makeCampaign();
    const [c1, err1] = applyCampaignAction(c, 'p1', reg, { kind: 'groupAddItem', item: { name: 'Gemma', quantity: 2, valueGp: 100, rarity: 'rare' } });
    expect(err1).toBeUndefined();
    expect(c1.groupInventory).toHaveLength(1);
    expect(c1.groupInventory[0].name).toBe('Gemma');
    const itemId = c1.groupInventory[0].id;
    // player non può rimuovere
    const [, err2] = applyCampaignAction(c1, 'p1', reg, { kind: 'groupRemoveItem', itemId });
    expect(err2).toBeTruthy();
    // master rimuove
    const [c2] = applyCampaignAction(c1, 'm1', reg, { kind: 'groupRemoveItem', itemId });
    expect(c2.groupInventory).toHaveLength(0);
    // re-add e dai al player
    const [c3] = applyCampaignAction(c2, 'm1', reg, { kind: 'groupAddItem', item: { name: 'Pozione', quantity: 1, valueGp: 50 } });
    const gid = c3.groupInventory[0].id;
    const [c4, err4] = applyCampaignAction(c3, 'm1', reg, { kind: 'groupGiveItem', itemId: gid, playerId: 'p1' });
    expect(err4).toBeUndefined();
    expect(c4.groupInventory).toHaveLength(0);
    expect(c4.characters.p1.inventory.some((i) => i.name === 'Pozione')).toBe(true);
  });

  it('groupAddCurrency solo master; masterAddXpAll a tutti i PG', () => {
    let c = makeCampaign();
    const [, err] = applyCampaignAction(c, 'p1', reg, { kind: 'groupAddCurrency', amount: { gp: 100 } });
    expect(err).toBeTruthy();
    const [c1] = applyCampaignAction(c, 'm1', reg, { kind: 'groupAddCurrency', amount: { gp: 100, sp: 50 } });
    expect(c1.groupCurrency.gp).toBe(100);
    const xpBefore = c1.characters.p1.xp;
    const [c2] = applyCampaignAction(c1, 'm1', reg, { kind: 'masterAddXpAll', amount: 300 });
    expect(c2.characters.p1.xp).toBe(xpBefore + 300);
    expect(c2.characters.m1.xp).toBeGreaterThan(300 - 1);
    expect(c2.characters.m1.journal[c2.characters.m1.journal.length - 1].text).toContain('+300 XP');
  });

  it('setCampaignNote solo master; setTemplate richiede combattimento e turno/master', () => {
    let c = makeCampaign();
    const [, err1] = applyCampaignAction(c, 'p1', reg, { kind: 'setCampaignNote', text: 'ciao' });
    expect(err1).toBeTruthy();
    const [c1] = applyCampaignAction(c, 'm1', reg, { kind: 'setCampaignNote', text: 'Sessione 3' });
    expect(c1.notes).toBe('Sessione 3');
    // template senza combattimento -> errore
    const [, err2] = applyCampaignAction(c1, 'm1', reg, { kind: 'setTemplate', template: { shape: 'sphere', sizeFt: 20 } });
    expect(err2).toBeTruthy();
    // avvia combattimento con i PG e piazza template
    const [c2] = applyCampaignAction(c1, 'm1', reg, { kind: 'startCombat' });
    const [c3, err3] = applyCampaignAction(c2, 'm1', reg, { kind: 'setTemplate', template: { shape: 'sphere', sizeFt: 20, originId: 'm1' } });
    expect(err3).toBeUndefined();
    expect(c3.combat?.template?.shape).toBe('sphere');
  });
});

describe('P2: generatore casuale', () => {
  it('randomName, rollEncounter e rollTreasure stanno nel tier giusto', () => {
    const name = randomName(RANDOM_DATA, () => 0.5);
    expect(name.length).toBeGreaterThan(3);
    const enc = rollEncounter(RANDOM_DATA, 2, () => 0.99);
    expect(enc.tier).toBe('Livello 1-4');
    expect(enc.enemies.length).toBeGreaterThan(0);
    expect(enc.xp).toBeGreaterThan(0);
    const encHigh = rollEncounter(RANDOM_DATA, 18, () => 0.01);
    expect(encHigh.tier).toBe('Livello 17-20');
    const tr = rollTreasure(RANDOM_DATA, 7, () => 0.5);
    expect(tr.text.length).toBeGreaterThan(0);
  });
});
