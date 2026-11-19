import { describe, expect, it } from 'vitest';
import {
  addItem,
  createCharacter,
  damage,
  equipConflicts,
  heal,
  longRest,
  maxHp,
  setEquipped,
  setItemSlot,
  shortRest,
  simulateTo20,
  slotOfItem,
  totalLevel,
  type Character,
  type Registry,
} from '../src/index.js';
import { createSrdRegistry } from '@dnd5e/data-srd';

function makeFighter(reg: Registry): Character {
  const res = createCharacter({
    name: 'Aldric',
    raceId: 'human',
    subraceId: 'human-standard',
    classId: 'fighter',
    abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
    skillChoices: ['athletics', 'perception'],
  }, reg);
  if (!res.character) throw new Error('creazione fallita: ' + res.errors.join(', '));
  return res.character;
}

describe('P3: riposo breve con dadi vita', () => {
  const reg = createSrdRegistry();
  it('cura con dadi vita e non supera i PF massimi', () => {
    let ch = makeFighter(reg);
    ch = damage(ch, 10);
    const before = ch.hp.current;
    const r = shortRest(ch, reg, 1);
    expect(r.healed).toBeGreaterThan(0);
    expect(r.character.hp.current).toBeGreaterThan(before);
    expect(r.character.hp.current).toBeLessThanOrEqual(maxHp(reg ? ch : ch, reg));
    // riposa di nuovo: non può superare maxHp
    const r2 = shortRest(r.character, reg, 20);
    expect(r2.character.hp.current).toBeLessThanOrEqual(maxHp(r2.character, reg));
  });
  it('a 0 PF il riposo breve risveglia e resetta i tiri della morte', () => {
    let ch = makeFighter(reg);
    ch = damage(ch, 9999);
    expect(ch.hp.current).toBe(0);
    ch = { ...ch, deathSaves: { successes: 0, failures: 2 } };
    const r = shortRest(ch, reg, 1);
    expect(r.character.hp.current).toBeGreaterThan(0);
    expect(r.character.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
  it('dice=0 non cura nulla', () => {
    let ch = makeFighter(reg);
    ch = damage(ch, 5);
    const r = shortRest(ch, reg, 0);
    expect(r.healed).toBe(0);
    expect(r.character.hp.current).toBe(ch.hp.current);
  });
});

describe('P3: slot di equipaggiamento', () => {
  const reg = createSrdRegistry();
  it('armatura e scudo hanno slot automatici', () => {
    const ch = makeFighter(reg);
    const a = addItem(ch, { name: 'Cotta', kind: 'armor', quantity: 1, weight: 10, equipped: false, magic: false, attuned: false });
    expect(slotOfItem(a.character.inventory[0])).toBe('armor');
  });
  it('equipaggiare un\'armatura nuova disequipaggia la vecchia', () => {
    let ch = makeFighter(reg);
    ch = addItem(ch, { name: 'Cotta', kind: 'armor', quantity: 1, weight: 10, equipped: false, magic: false, attuned: false }).character;
    ch = addItem(ch, { name: 'Piastre', kind: 'armor', quantity: 1, weight: 40, equipped: false, magic: false, attuned: false }).character;
    const cotta = ch.inventory.find((i) => i.name === 'Cotta')!;
    const piastre = ch.inventory.find((i) => i.name === 'Piastre')!;
    ch = setEquipped(ch, cotta.id, true);
    expect(ch.inventory.find((i) => i.name === 'Cotta')!.equipped).toBe(true);
    ch = setEquipped(ch, piastre.id, true);
    expect(ch.inventory.find((i) => i.name === 'Piastre')!.equipped).toBe(true);
    expect(ch.inventory.find((i) => i.name === 'Cotta')!.equipped).toBe(false);
    expect(equipConflicts(ch)).toHaveLength(0);
  });
  it('le armi vanno nella prima mano libera', () => {
    let ch = makeFighter(reg);
    ch = addItem(ch, { name: 'Spada lunga', kind: 'weapon', quantity: 1, weight: 3, equipped: false, magic: false, attuned: false }).character;
    ch = addItem(ch, { name: 'Ascia', kind: 'weapon', quantity: 1, weight: 2, equipped: false, magic: false, attuned: false }).character;
    const spada = ch.inventory.find((i) => i.name === 'Spada lunga')!;
    const ascia = ch.inventory.find((i) => i.name === 'Ascia')!;
    ch = setEquipped(ch, spada.id, true);
    ch = setEquipped(ch, ascia.id, true);
    expect(ch.inventory.find((i) => i.name === 'Spada lunga')!.slot).toBe('hand1');
    expect(ch.inventory.find((i) => i.name === 'Ascia')!.slot).toBe('hand2');
    expect(equipConflicts(ch)).toHaveLength(0);
  });
  it('setItemSlot libera lo slot dagli altri oggetti equipaggiati', () => {
    let ch = makeFighter(reg);
    ch = addItem(ch, { name: 'Amuleto A', kind: 'treasure', quantity: 1, weight: 0, equipped: true, magic: false, attuned: false, slot: 'amulet' }).character;
    ch = addItem(ch, { name: 'Amuleto B', kind: 'treasure', quantity: 1, weight: 0, equipped: true, magic: false, attuned: false, slot: 'amulet' }).character;
    expect(equipConflicts(ch)).toHaveLength(1);
    const b = ch.inventory.find((i) => i.name === 'Amuleto B')!;
    ch = setItemSlot(ch, b.id, 'ring1');
    expect(equipConflicts(ch)).toHaveLength(0);
  });
});

describe('creazione: stile di combattimento al liv 1', () => {
  const reg = createSrdRegistry();
  it('il guerriero può scegliere lo stile in creazione', () => {
    const res = createCharacter({
      name: 'A', raceId: 'human', subraceId: 'human-standard', classId: 'fighter',
      abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
      skillChoices: ['athletics'], fightingStyleId: 'defense',
    }, reg);
    expect(res.errors).toEqual([]);
    expect(res.character!.fightingStyles).toEqual(['defense']);
  });
  it('senza scelta usa il primo stile disponibile (default)', () => {
    const res = createCharacter({
      name: 'B', raceId: 'human', classId: 'fighter',
      abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
    }, reg);
    expect(res.errors).toEqual([]);
    expect(res.character!.fightingStyles.length).toBe(1);
  });
  it('stile non valido -> errore', () => {
    const res = createCharacter({
      name: 'C', raceId: 'human', classId: 'fighter',
      abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
      fightingStyleId: 'non-esiste',
    }, reg);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.character).toBeUndefined();
  });
  it('classe senza stili al liv 1 rifiuta uno stile', () => {
    const res = createCharacter({
      name: 'D', raceId: 'human', classId: 'wizard',
      abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 13, cha: 10 },
      fightingStyleId: 'defense',
    }, reg);
    expect(res.errors.some((e) => e.includes('stili di combattimento'))).toBe(true);
  });
});

describe('P3: simulateTo20 su tutte le classi SRD', () => {
  const reg = createSrdRegistry();
  it('ogni classe SRD sale fino al 20 senza errori', () => {
    const scores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    for (const cls of reg.classes.values()) {
      const res = createCharacter({ name: 'Test', raceId: 'human', subraceId: 'human-standard', classId: cls.id, abilityScores: scores }, reg);
      if (!res.character) throw new Error(`creazione ${cls.id} fallita: ${res.errors.join(', ')}`);
      const sim = simulateTo20(res.character, reg);
      expect(sim.errors, `classe ${cls.id}: ${sim.errors.join(' | ')}`).toEqual([]);
      expect(totalLevel(sim.character), `classe ${cls.id} livello finale`).toBe(20);
    }
  });
  it('longRest dopo la simulazione ripristina gli slot', () => {
    const res = createCharacter({ name: 'Wiz', raceId: 'elf', subraceId: 'high-elf', classId: 'wizard', abilityScores: { str: 8, dex: 14, con: 12, int: 15, wis: 13, cha: 10 } }, reg);
    const sim = simulateTo20(res.character!, reg);
    const rested = longRest(sim.character, reg);
    for (const s of Object.values(rested.spellSlots)) expect(s.used).toBe(0);
    expect(rested.hp.current).toBe(maxHp(rested, reg));
    expect(heal(rested, 0, maxHp(rested, reg)).hp.current).toBe(maxHp(rested, reg));
  });
});
