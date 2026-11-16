import { describe, expect, it } from 'vitest';
import {
  addSpellKnown,
  addXp,
  applyLevelUp,
  forgetSpell,
  knownSpellCount,
  maxSpellsKnown,
  setAttuned,
  addItem,
  unlockedMechanics,
  createCharacter,
  type Character,
  type Registry,
} from '../src/index.js';
import { createSrdRegistry } from '@dnd5e/data-srd';

function makeWizard(reg: Registry): Character {
  const res = createCharacter({
    name: 'Elara', raceId: 'elf', subraceId: 'high-elf', classId: 'wizard',
    abilityScores: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    skillChoices: ['arcana', 'investigation'],
  }, reg);
  if (!res.character) throw new Error(res.errors.join(', '));
  return res.character;
}

function makeRogue(reg: Registry): Character {
  const res = createCharacter({
    name: 'Vex', raceId: 'human', subraceId: 'human-standard', classId: 'rogue',
    abilityScores: { str: 10, dex: 16, con: 14, int: 12, wis: 12, cha: 10 },
  }, reg);
  if (!res.character) throw new Error(res.errors.join(', '));
  return res.character;
}

describe('limite incantesimi appresi', () => {
  const reg = createSrdRegistry();
  it('il mago livello 1 con Int 17 conoce al massimo 1+3=4 incantesimi (non trucchetti)', () => {
    const c = makeWizard(reg); // int 16 +1 alto elfo = 17 -> +3
    expect(maxSpellsKnown(c, reg)).toBe(4);
    const spells = ['magic-missile', 'shield', 'burning-hands', 'sleep', 'fireball'];
    let ch = c;
    for (const s of spells.slice(0, 4)) {
      const r = addSpellKnown(ch, s, reg);
      expect(r.error).toBeUndefined();
      ch = r.character;
    }
    expect(knownSpellCount(ch, reg)).toBe(4);
    const fifth = addSpellKnown(ch, spells[4], reg);
    expect(fifth.error).toContain('Limite raggiunto');
    // i trucchetti non contano verso il limite
    const cantrip = addSpellKnown(ch, 'fire-bolt', reg);
    expect(cantrip.error).toBeUndefined();
    // dimentica e impara di nuovo
    const forgot = forgetSpell(ch, 'sleep');
    expect(forgot.error).toBeUndefined();
    const again = addSpellKnown(forgot.character, 'fireball', reg);
    expect(again.error).toBeUndefined();
  });
  it('house-rule bypassSpellLimit rimuove il limite', () => {
    let c = makeWizard(reg);
    c = { ...c, houseRules: { ...c.houseRules, bypassSpellLimit: true } };
    for (const s of ['magic-missile', 'shield', 'burning-hands', 'sleep', 'fireball', 'invisibility']) {
      const r = addSpellKnown(c, s, reg);
      expect(r.error).toBeUndefined();
      c = r.character;
    }
    expect(knownSpellCount(c, reg)).toBe(6);
  });
  it('il limite scala con il livello e il modificatore', () => {
    let c = addXp(makeWizard(reg), 355000);
    const choices = [
      { hpRoll: 4, subclassId: 'evocation' },
      { hpRoll: 4 },
      { hpRoll: 4, asi: { int: 2 } },
      { hpRoll: 4 },
    ];
    for (const ch of choices) c = applyLevelUp(c, reg, { classId: 'wizard', ...ch }).character;
    // liv 5, int 18 -> +4 => max = 5 + 4 = 9
    expect(maxSpellsKnown(c, reg)).toBe(9);
  });
});

describe('house-rules: eludere le regole', () => {
  const reg = createSrdRegistry();
  it('bypassXpCheck permette il level-up senza XP', () => {
    let c = makeWizard(reg);
    const noXp = applyLevelUp(c, reg, { classId: 'wizard', hpRoll: 4, subclassId: 'evocation' });
    expect(noXp.errors.some((e) => e.includes('XP'))).toBe(true);
    c = { ...c, houseRules: { ...c.houseRules, bypassXpCheck: true } };
    const ok = applyLevelUp(c, reg, { classId: 'wizard', hpRoll: 4, subclassId: 'evocation' });
    expect(ok.errors).toEqual([]);
  });
  it('bypassAsiCap permette caratteristiche sopra 20', () => {
    let c = addXp(makeWizard(reg), 2700);
    c = applyLevelUp(c, reg, { classId: 'wizard', hpRoll: 4, subclassId: 'evocation' }).character; // liv 2
    c = applyLevelUp(c, reg, { classId: 'wizard', hpRoll: 4 }).character; // liv 3
    // liv 4 ha l'ASI: int 19 + 2 = 21 supera il cap 20
    let d = { ...c, abilityScores: { ...c.abilityScores, int: 19 } };
    const over = applyLevelUp(d, reg, { classId: 'wizard', hpRoll: 4, asi: { int: 2 } });
    expect(over.errors.some((e) => e.includes('20'))).toBe(true);
    d = { ...d, houseRules: { ...d.houseRules, bypassAsiCap: true } };
    const overOk = applyLevelUp(d, reg, { classId: 'wizard', hpRoll: 4, asi: { int: 2 } });
    expect(overOk.errors).toEqual([]);
    expect(overOk.character.abilityScores.int).toBe(21);
  });
  it('bypassAttunementLimit rimuove il cap di 3 oggetti sintonizzati', () => {
    let c = makeWizard(reg);
    for (let i = 0; i < 4; i++) c = addItem(c, { name: `Anello ${i}`, kind: 'treasure', quantity: 1, weight: 0, equipped: false, magic: true, attuned: false }).character;
    for (let i = 0; i < 3; i++) c = setAttuned(c, c.inventory[i].id, true).character;
    expect(setAttuned(c, c.inventory[3].id, true).error).toBeDefined();
    c = { ...c, houseRules: { ...c.houseRules, bypassAttunementLimit: true } };
    expect(setAttuned(c, c.inventory[3].id, true).error).toBeUndefined();
  });
});

describe('meccaniche sbloccate con il livello', () => {
  const reg = createSrdRegistry();
  it('ladro livello 5: attacco furtivo 3d6, risorse e reazioni', () => {
    let c = addXp(makeRogue(reg), 6500); // liv 5
    c = applyLevelUp(c, reg, { classId: 'rogue', hpRoll: 5 }).character; // liv 2
    c = applyLevelUp(c, reg, { classId: 'rogue', hpRoll: 5, subclassId: 'thief' }).character; // liv 3
    c = applyLevelUp(c, reg, { classId: 'rogue', hpRoll: 5, asi: { dex: 2 } }).character; // liv 4
    c = applyLevelUp(c, reg, { classId: 'rogue', hpRoll: 5 }).character; // liv 5
    const mechs = unlockedMechanics(c, reg);
    const sneak = mechs.find((m) => m.id.startsWith('scaling-sneak-attack'));
    expect(sneak?.detail).toBe('3d6 danni extra'); // liv 5: floor(4/2)+1 = 3
    expect(mechs.some((m) => m.name === 'Azione Scaltra')).toBe(true);
    expect(mechs.some((m) => m.name === 'Schivata Prodigiosa')).toBe(true);
  });
  it('guerriero livello 2: Azione Impetuosa con 1 uso a riposo lungo', () => {
    let c = addXp(createCharacter({
      name: 'A', raceId: 'human', subraceId: 'human-standard', classId: 'fighter',
      abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
    }, reg).character!, 300);
    c = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 7, fightingStyleId: 'defense' }).character;
    const mechs = unlockedMechanics(c, reg);
    const surge = mechs.find((m) => m.name === 'Azione Impetuosa');
    expect(surge?.detail).toContain('1 usi');
    expect(surge?.detail).toContain('riposo lungo');
  });
});
