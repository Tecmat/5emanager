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

  maxSpellSlotLevel,
  knownCantripCount,
  learnableSpells,
  cantripsKnown,
  prepareSpell} from '../src/index.js';
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

/** wizard con slot fino al 9° (per testare i limiti senza il gate del livello slot) */
function makeWizardSlots(reg: Registry): Character {
  const c = makeWizard(reg);
  const slots: Record<number, { total: number; used: number }> = {};
  for (let l = 1; l <= 9; l++) slots[l] = { total: 1, used: 0 };
  return { ...c, spellSlots: slots };
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
  it('il mago livello 1 con Int 17 conosce al massimo 1+3=4 incantesimi (non trucchetti)', () => {
    const c = makeWizardSlots(reg); // int 16 +1 alto elfo = 17 -> +3 (slot alti per non colpire il gate di livello)
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

describe('migrazione schede vecchie', () => {
  it('migrateCharacter riempie houseRules mancante', async () => {
    const { migrateCharacter, DEFAULT_HOUSE_RULES } = await import('../src/index.js');
    const reg = createSrdRegistry();
    const c = makeWizard(reg);
    const old = { ...c } as Partial<Character>;
    delete old.houseRules;
    const migrated = migrateCharacter(old as Character);
    expect(migrated.houseRules).toEqual(DEFAULT_HOUSE_RULES);
    expect(migrated.name).toBe('Elara');
  });
});

describe('gate livello slot e limite trucchetti (RAW)', () => {
  const reg = createSrdRegistry();
  it("un PG di 1° (solo slot 1°) non può imparare incantesimi di livello superiore", () => {
    const c = makeWizard(reg); // liv 1 -> max slot 1
    expect(maxSpellSlotLevel(c)).toBe(1);
    const r = addSpellKnown(c, 'fireball', reg); // 3° livello
    expect(r.error).toContain('slot');
    expect(r.character.spellsKnown).not.toContain('fireball');
    // ma uno di 1° sì
    const ok = addSpellKnown(c, 'magic-missile', reg);
    expect(ok.error).toBeUndefined();
  });
  it('learnableSpells filtra gli incantesimi oltre il livello degli slot', () => {
    const c = makeWizard(reg);
    const list = learnableSpells(c, reg).map((s) => s.id);
    expect(list).toContain('magic-missile');
    expect(list).not.toContain('fireball');
  });
  it('limite trucchetti: il mago di 1° ne conosce al massimo 3', () => {
    let c = makeWizard(reg);
    expect(cantripsKnown(c, reg)).toBe(3);
    for (const id of ['fire-bolt', 'mage-hand', 'light']) {
      const r = addSpellKnown(c, id, reg);
      expect(r.error).toBeUndefined();
      c = r.character;
    }
    expect(knownCantripCount(c, reg)).toBe(3);
    const fourth = addSpellKnown(c, 'prestidigitation', reg);
    expect(fourth.error).toContain('trucchetti');
    // dimenticando uno, si puo' imparare il quarto
    c = forgetSpell(c, 'light').character;
    const r2 = addSpellKnown(c, 'prestidigitation', reg);
    expect(r2.error).toBeUndefined();
  });
  it('non si prepara un incantesimo di livello superiore agli slot', () => {
    const c = makeWizardSlots(reg);
    const learned = addSpellKnown(c, 'fireball', reg);
    expect(learned.error).toBeUndefined();
    const low = { ...learned.character, spellSlots: { 1: { total: 2, used: 0 } } }; // solo slot 1°
    const r = prepareSpell(low, 'fireball', reg);
    expect(r.error).toContain('slot');
  });
});
