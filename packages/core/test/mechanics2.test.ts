import { describe, expect, it } from 'vitest';
import {
  addCombatant,
  addCondition,
  currentCombatant,
  damageCombatant,
  hasDisadvantageFromConditions,
  healCombatant,
  nextTurn,
  parseDice,
  removeCondition,
  rerollInitiatives,
  rollDice,
  setCombatantCondition,
  startCombat,
  createCharacter,
  type Character,
} from '../src/index.js';
import { createSrdRegistry } from '@dnd5e/data-srd';

const reg = createSrdRegistry();

function makeChar(): Character {
  const res = createCharacter({
    name: 'Test', raceId: 'human', subraceId: 'human-standard', classId: 'fighter',
    abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
  }, reg);
  if (!res.character) throw new Error('fail');
  return res.character;
}

describe('dadi', () => {
  it('parseDice valida espressioni', () => {
    expect(parseDice('2d6+3')).toEqual({ dice: [{ count: 2, faces: 6, sign: 1 }], mod: 3 });
    expect(parseDice('d20')).toEqual({ dice: [{ count: 1, faces: 20, sign: 1 }], mod: 0 });
    expect(parseDice('1d8-1')).toEqual({ dice: [{ count: 1, faces: 8, sign: 1 }], mod: -1 });
    expect(parseDice('2d6+1d4+2')).toEqual({ dice: [{ count: 2, faces: 6, sign: 1 }, { count: 1, faces: 4, sign: 1 }], mod: 2 });
    expect(parseDice('-2d6')).toEqual({ dice: [{ count: 2, faces: 6, sign: -1 }], mod: 0 });
    expect(parseDice('abc')).toBeNull();
    expect(parseDice('')).toBeNull();
    expect(parseDice('999d6')).toBeNull();
  });
  it('rollDice rispetta i range', () => {
    for (let i = 0; i < 50; i++) {
      const r = rollDice('2d6+3')!;
      expect(r.total).toBeGreaterThanOrEqual(2 + 3);
      expect(r.total).toBeLessThanOrEqual(12 + 3);
      expect(r.rolls).toHaveLength(2);
    }
    const d20 = rollDice('1d20')!;
    expect(d20.total).toBeGreaterThanOrEqual(1);
    expect(d20.total).toBeLessThanOrEqual(20);
  });
  it('vantaggio/svantaggio su d20 tiene un solo risultato', () => {
    const adv = rollDice('1d20', 'advantage')!;
    expect(adv.rolls).toHaveLength(1);
    expect(adv.dropped).toHaveLength(1);
    const dis = rollDice('1d20', 'disadvantage')!;
    expect(dis.rolls).toHaveLength(1);
  });
});

describe('condizioni', () => {
  it('add/remove e svantaggio da condizioni', () => {
    let c = makeChar();
    c = addCondition(c, 'poisoned');
    expect(c.conditions).toContain('poisoned');
    expect(hasDisadvantageFromConditions(c)).toBe(true);
    c = addCondition(c, 'invisible');
    expect(hasDisadvantageFromConditions(c)).toBe(true);
    c = removeCondition(c, 'poisoned');
    expect(c.conditions).not.toContain('poisoned');
    expect(() => addCondition(c, 'non-esiste')).toThrow();
  });
});

describe('combattimento', () => {
  it('startCombat include il personaggio e ordina per initiative', () => {
    const c = makeChar();
    let s = startCombat(c);
    s = addCombatant(s, { name: 'Goblin', hp: 7, initiative: 18 });
    s = addCombatant(s, { name: 'Orco', hp: 15, initiative: 5 });
    expect(s.combatants).toHaveLength(3);
    const names = s.combatants.map((x) => x.name);
    expect(names).toContain('Goblin');
    expect(names).toContain('Orco');
    expect(names.indexOf('Goblin')).toBeLessThan(names.indexOf('Orco')); // 18 > 5
    for (let i = 1; i < s.combatants.length; i++) {
      expect(s.combatants[i - 1].initiative).toBeGreaterThanOrEqual(s.combatants[i].initiative);
    }
  });
  it('nextTurn gira i turni e i round', () => {
    let s: import('../src/index.js').CombatState = {
      combatants: [
        { id: 'a', name: 'A', hp: 10, maxHp: 10, initiative: 20, conditions: [], isPlayer: false },
        { id: 'b', name: 'B', hp: 10, maxHp: 10, initiative: 5, conditions: [], isPlayer: false },
      ],
      round: 1,
      turnIndex: 0,
    };
    expect(currentCombatant(s)?.name).toBe('A');
    s = nextTurn(s);
    expect(currentCombatant(s)?.name).toBe('B');
    expect(s.round).toBe(1);
    s = nextTurn(s); // giro completo: torna ad A, round 2
    expect(currentCombatant(s)?.name).toBe('A');
    expect(s.round).toBe(2);
  });
  it('danni/cura/condizioni sui combattenti', () => {
    let s = startCombat(makeChar());
    s = addCombatant(s, { name: 'Goblin', hp: 7, initiative: 18 });
    const gob = s.combatants.find((c) => c.name === 'Goblin')!;
    s = damageCombatant(s, gob.id, 3);
    expect(s.combatants.find((c) => c.id === gob.id)?.hp).toBe(4);
    s = healCombatant(s, gob.id, 10);
    expect(s.combatants.find((c) => c.id === gob.id)?.hp).toBe(7); // cap a maxHp
    s = setCombatantCondition(s, gob.id, 'prone', true);
    expect(s.combatants.find((c) => c.id === gob.id)?.conditions).toContain('prone');
    s = rerollInitiatives(s);
    expect(s.turnIndex).toBe(0);
  });
});
