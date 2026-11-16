import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  addCurrency,
  addCustomClass,
  addCustomSpell,
  addCustomWeapon,
  addItem,
  addSpellKnown,
  addXp,
  applyLevelUp,
  armorClass,
  attackBonus,
  canLevelUp,
  carryingCapacity,
  castSpell,
  computeSpellSlots,
  createCharacter,
  currencyToCopper,
  damage,
  isValidDice,
  levelForXp,
  longRest,
  maxHp,
  passivePerception,
  prepareSpell,
  proficiencyBonus,
  savingThrowBonus,
  setAttuned,
  setEquipped,
  skillBonus,
  totalLevel,
  totalWeight,
  validateClassDef,
  validateSpellDef,
  type Character,
} from '../src/index.js';
import { createSrdRegistry } from '@dnd5e/data-srd';
import type { Registry } from '../src/index.js';

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

function makeWizard(reg: Registry): Character {
  const res = createCharacter({
    name: 'Elara',
    raceId: 'elf',
    subraceId: 'high-elf',
    classId: 'wizard',
    abilityScores: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    skillChoices: ['arcana', 'investigation'],
  }, reg);
  if (!res.character) throw new Error('creazione fallita: ' + res.errors.join(', '));
  return res.character;
}

describe('registry SRD', () => {
  const reg = createSrdRegistry();
  it('carica classi, razze, incantesimi, armi, armature', () => {
    expect(reg.classes.size).toBe(5);
    expect(reg.races.size).toBe(9);
    expect(reg.spells.size).toBeGreaterThan(90);
    expect(reg.weapons.size).toBeGreaterThan(30);
    expect(reg.armors.size).toBe(13);
    expect(reg.subclasses.size).toBe(6);
  });
  it('i full caster hanno la tabella slot compilata', () => {
    const wiz = reg.classes.get('wizard')!;
    expect(wiz.spellcasting!.slots[1]).toEqual([2]);
    expect(wiz.spellcasting!.slots[20]).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });
});

describe('creazione personaggio e stat derivate', () => {
  const reg = createSrdRegistry();
  it('applica bonus razziali e calcola PF, TS, competenze', () => {
    const c = makeFighter(reg);
    // human standard +1 a tutte
    expect(c.abilityScores.str).toBe(17);
    expect(c.abilityScores.cha).toBe(9);
    expect(totalLevel(c)).toBe(1);
    expect(maxHp(c, reg)).toBe(10 + 3); // dado pieno + mod Con (16 -> +3)
    expect(c.hp.current).toBe(13);
    expect(proficiencyBonus(1)).toBe(2);
    expect(savingThrowBonus(c, 'str', reg)).toBe(3 + 2); // 17 -> +3, prof str
    expect(savingThrowBonus(c, 'dex', reg)).toBe(2); // no prof
    expect(skillBonus(c, 'athletics')).toBe(3 + 2);
    expect(skillBonus(c, 'perception')).toBe(1 + 2); // wis 13 -> +1
    expect(passivePerception(c)).toBe(10 + 3);
  });
  it('proficienza armi: spada lunga per il guerriero', () => {
    const c = makeFighter(reg);
    const longsword = reg.weapons.get('longsword')!;
    expect(attackBonus(c, longsword).bonus).toBe(3 + 2); // str 17 -> +3, prof
  });
});

describe('XP e level-up', () => {
  const reg = createSrdRegistry();
  it('tabella XP e bonus proficiency', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
    expect(levelForXp(355000)).toBe(20);
    expect(proficiencyBonus(1)).toBe(2);
    expect(proficiencyBonus(5)).toBe(3);
    expect(proficiencyBonus(9)).toBe(4);
    expect(proficiencyBonus(20)).toBe(6);
  });
  it('level-up al 2°: dado vita, feature, PF', () => {
    let c = makeFighter(reg);
    c = addXp(c, 300);
    expect(canLevelUp(c)).toBe(true);
    const res = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 7 });
    expect(res.errors).toEqual([]);
    c = res.character;
    expect(totalLevel(c)).toBe(2);
    expect(maxHp(c, reg)).toBe(10 + 3 + 7 + 3);
    expect(c.features).toContain('action-surge');
  });
  it('level-up senza XP suficiente fallisce', () => {
    const c = makeFighter(reg);
    const res = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 5 });
    expect(res.errors.length).toBeGreaterThan(0);
  });
  it('ASI al 4°: +2 a una caratteristica, validazione', () => {
    let c = addXp(makeFighter(reg), 2700); // livello 4
    c = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6 }).character; // liv 2
    c = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6, subclassId: 'champion' }).character; // liv 3
    const bad = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6, asi: { str: 1 } });
    expect(bad.errors.some((e) => e.includes('ASI'))).toBe(true);
    const ok = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6, asi: { str: 2 } });
    expect(ok.errors).toEqual([]);
    expect(ok.character.abilityScores.str).toBe(19);
    expect(savingThrowBonus(ok.character, 'str', reg)).toBe(4 + 2);
  });
  it('al posto dell\'ASI si può scegliere un talento', () => {
    let c = addXp(makeFighter(reg), 2700);
    c = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6 }).character;
    c = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6, subclassId: 'champion' }).character;
    const r = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6, featId: 'tough' });
    expect(r.errors).toEqual([]);
    expect(r.character.feats).toContain('tough');
    expect(r.character.abilityScores.str).toBe(17); // nessun ASI applicato
  });
  it('sottoclasse richiesta al 3° e granted', () => {
    let c = addXp(makeFighter(reg), 900);
    c = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6 }).character;
    const noSub = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6 });
    expect(noSub.errors.some((e) => e.toLowerCase().includes('archetipo'))).toBe(true);
    const ok = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6, subclassId: 'champion' });
    expect(ok.errors).toEqual([]);
    expect(ok.grantedFeatures.some((f) => f.id === 'improved-critical')).toBe(true);
  });
});

describe('CA, attacchi e inventario', () => {
  const reg = createSrdRegistry();
  it('CA con armatura media + scudo', () => {
    let c = makeFighter(reg); // dex 15 -> +2
    c = addItem(c, { name: 'Cotta di Maglia', kind: 'armor', quantity: 1, weight: 20, equipped: true, refId: 'chain-mail', magic: false, attuned: false }).character;
    c = setEquipped(c, c.inventory[0].id, true);
    c = addItem(c, { name: 'Scudo', kind: 'shield', quantity: 1, weight: 6, equipped: true, refId: 'shield', magic: false, attuned: false }).character;
    const { ac } = armorClass(c, reg);
    expect(ac).toBe(16 + 2 + 2); // chain mail 16 + dex cap +2 + scudo 2
  });
  it('CA senza armatura = 10 + Des', () => {
    const c = makeWizard(reg); // elfo: dex 14+2=16 -> +3
    expect(armorClass(c, reg).ac).toBe(13);
  });
  it('peso, capacità di carico, valuta', () => {
    let c = makeFighter(reg); // str 17
    c = addItem(c, { name: 'Spada Lunga', kind: 'weapon', quantity: 1, weight: 3, equipped: true, refId: 'longsword', magic: false, attuned: false }).character;
    c = addItem(c, { name: 'Razione', kind: 'gear', quantity: 5, weight: 2, equipped: false, magic: false, attuned: false }).character;
    expect(totalWeight(c)).toBe(3 + 10);
    expect(carryingCapacity(c).normal).toBe(17 * 15);
    c = addCurrency(c, { gp: 10, sp: 5 });
    expect(currencyToCopper(c.currency)).toBe(1000 + 50);
  });
  it('sintonizzazione max 3 oggetti magici', () => {
    let c = makeFighter(reg);
    for (let i = 0; i < 4; i++) {
      const r = addItem(c, { name: `Anello ${i}`, kind: 'treasure', quantity: 1, weight: 0, equipped: false, magic: true, attuned: false });
      c = r.character;
    }
    for (let i = 0; i < 3; i++) {
      const r = setAttuned(c, c.inventory[i].id, true);
      expect(r.error).toBeUndefined();
      c = r.character;
    }
    const fourth = setAttuned(c, c.inventory[3].id, true);
    expect(fourth.error).toContain('3');
  });
  it('danni e PF temporanei', () => {
    let c = makeFighter(reg);
    c = { ...c, hp: { current: 13, temp: 5 } };
    c = damage(c, 8);
    expect(c.hp).toEqual({ current: 10, temp: 0 });
    c = damage(c, 12);
    expect(c.hp.current).toBe(0);
  });
});

describe('incantesimi e slot', () => {
  const reg = createSrdRegistry();
  it('mago livello 1: 2 slot di 1°, lancio e upcast', () => {
    let c = makeWizard(reg);
    expect(c.spellSlots[1]).toEqual({ total: 2, used: 0 });
    let r = addSpellKnown(c, 'magic-missile', reg);
    c = r.character;
    r = addSpellKnown(c, 'shield', reg);
    c = r.character;
    let cast = castSpell(c, 'magic-missile', 1, reg);
    expect(cast.error).toBeUndefined();
    c = cast.character;
    c = castSpell(c, 'magic-missile', 1, reg).character;
    const third = castSpell(c, 'magic-missile', 1, reg);
    expect(third.error).toContain('esauriti');
    // non si può lanciare un incantesimo non conosciuto
    expect(castSpell(c, 'fireball', 3, reg).error).toContain('non conosciuto');
    // upcast vietato verso il basso
    expect(castSpell(c, 'magic-missile', 0, reg).error).toBeDefined();
  });
  it('livello 3: slot 4/2, upcast al 2°, concentration, riposo lungo', () => {
    let c = addXp(makeWizard(reg), 2700);
    c = applyLevelUp(c, reg, { classId: 'wizard', hpRoll: 4, subclassId: 'evocation' }).character; // liv 2
    c = applyLevelUp(c, reg, { classId: 'wizard', hpRoll: 4 }).character; // liv 3
    expect(c.spellSlots[1]!.total).toBe(4);
    expect(c.spellSlots[2]!.total).toBe(2);
    let r = addSpellKnown(c, 'invisibility', reg);
    c = r.character;
    r = prepareSpell(c, 'invisibility', reg);
    expect(r.error).toBeUndefined();
    c = r.character;
    const cast = castSpell(c, 'invisibility', 3, reg);
    expect(cast.error).toContain('Nessuno slot'); // niente slot di 3° al liv 3
    const cast2 = castSpell(c, 'invisibility', 2, reg);
    expect(cast2.error).toBeUndefined();
    expect(cast2.character.concentrationSpellId).toBe('invisibility');
    const rested = longRest(cast2.character, reg);
    expect(rested.spellSlots[2]!.used).toBe(0);
    expect(rested.concentrationSpellId).toBeUndefined();
    expect(rested.hp.current).toBe(maxHp(rested, reg));
  });
  it('multiclasse paladino 5 + mago 5: livello caster 7', () => {
    let c = addXp(makeWizard(reg), 355000);
    const wizChoices = [
      { hpRoll: 4, subclassId: 'evocation' }, // liv 2
      { hpRoll: 4 }, // liv 3
      { hpRoll: 4, asi: { int: 2 } }, // liv 4
      { hpRoll: 4 }, // liv 5
    ];
    for (const ch of wizChoices) c = applyLevelUp(c, reg, { classId: 'wizard', ...ch }).character;
    for (let i = 0; i < 5; i++) c = applyLevelUp(c, reg, { classId: 'paladin', hpRoll: 6, subclassId: i === 2 ? 'oath-of-devotion' : undefined, fightingStyleId: i === 1 ? 'defense' : undefined, asi: i === 3 ? { cha: 2 } : undefined }).character;
    expect(totalLevel(c)).toBe(10);
    const slots = computeSpellSlots(c, reg);
    // caster level = 5 (full) + floor(5/2) = 7 -> tabella full caster liv 7: 4,3,3,1
    expect(slots[1]!.total).toBe(4);
    expect(slots[4]!.total).toBe(1);
    expect(slots[5]).toBeUndefined();
  });
});

describe('contenuti custom e validazione', () => {
  const reg = createSrdRegistry();
  it('incantesimo custom valido e non valido', () => {
    const bad = addCustomSpell(reg, {
      id: 'Palla Di Meteorite Custom', name: 'x', level: 12, school: 'evocation',
      castingTime: '1 azione', range: '9 m', components: 'V', duration: 'x', description: 'x', source: 'custom',
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
    const good = addCustomSpell(reg, {
      id: 'dardo-del-drago', name: 'Dardo del Drago', level: 2, school: 'evocation',
      castingTime: '1 azione', range: '24 m', components: 'V, S', duration: 'Istantanea',
      description: 'Un dardo infuocato personalizzato.', damage: '3d6', classes: ['wizard'], source: 'custom',
    });
    expect(good.ok).toBe(true);
    expect(reg.spells.has('dardo-del-drago')).toBe(true);
  });
  it('arma custom: dado non valido rifiutato', () => {
    const bad = addCustomWeapon(reg, {
      id: 'ascia-pesante', name: 'Ascia Pesante', category: 'martial', type: 'melee',
      damage: '1d12x', damageType: 'taglio', properties: ['due mani'], weight: 7,
      cost: { value: 30, unit: 'gp' }, source: 'custom',
    });
    expect(bad.ok).toBe(false);
    expect(isValidDice('2d6+3')).toBe(true);
    expect(isValidDice('1d12x')).toBe(false);
  });
  it('classe custom valida: personaggio e level-up funzionano', () => {
    const cls = {
      id: 'stregone', name: 'Stregone', hitDie: 8 as const, primaryAbility: ['cha' as const],
      savingThrows: ['con' as const, 'cha' as const],
      armorProficiencies: ['light'], weaponProficiencies: ['simple'], toolProficiencies: [],
      skillChoices: { choose: 2, from: ['arcana', 'deception'] },
      features: {
        1: [{ id: 'origine-magica', name: 'Origine Magica', description: 'Hai sangue magico.', effects: [{ type: 'custom' as const, description: 'Origine magica.' }] }],
        2: [{ id: 'asi-2', name: 'Aumento', description: '+2.', effects: [{ type: 'asi' as const, points: 2 }, { type: 'feat' as const }] }],
      },
      source: 'custom' as const,
    };
    expect(validateClassDef(cls)).toEqual([]);
    const r = addCustomClass(reg, cls);
    expect(r.ok).toBe(true);
    const badCls = { ...cls, id: 'rotto', hitDie: 7 as unknown as 8 };
    expect(validateClassDef(badCls).some((e) => e.includes('hitDie'))).toBe(true);

    const created = createCharacter({
      name: 'Vex', raceId: 'tiefling', classId: 'stregone',
      abilityScores: { str: 10, dex: 12, con: 14, int: 10, wis: 12, cha: 16 },
    }, reg);
    expect(created.errors).toEqual([]);
    let c = addXp(created.character!, 300);
    const up = applyLevelUp(c, reg, { classId: 'stregone', hpRoll: 5, asi: { cha: 2 } });
    expect(up.errors).toEqual([]);
    expect(up.character.abilityScores.cha).toBe(18 + 2); // tiefling +2 cha = 18, poi +2
  });
  it('validazione incantesimo: livello e campi obbligatori', () => {
    expect(validateSpellDef({ id: 'ok', name: 'Ok', level: 0, school: 'evocation', castingTime: '1 a', range: '1 m', components: 'V', duration: 'x', description: 'x' })).toEqual([]);
    const errs = validateSpellDef({ id: 'BAD ID', level: -1 });
    expect(errs.length).toBeGreaterThan(2);
  });
  it('tutti i punteggi caratteristica sono chiavi valide', () => {
    expect(ABILITIES).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  });
});
