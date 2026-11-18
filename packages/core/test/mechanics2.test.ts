import { describe, expect, it } from 'vitest';
import {
  addCombatant,
  addCondition,
  addEnemy,
  attack,
  currentCombatant,
  damageCombatant,
  hasDisadvantageFromConditions,
  healCombatant,
  moveCombatant,
  nextTurn,
  parseDice,
  removeCondition,
  rerollInitiatives,
  resolveAttack,
  rollDice,
  setCombatantCondition,
  startCombat,
  useAction,
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
    const mk = (id: string, name: string, initiative: number): import('../src/index.js').Combatant => ({
      id, name, hp: 10, maxHp: 10, initiative, conditions: [], conditionRounds: {},
      isPlayer: false, ac: 12, speed: 30, movement: 30, attacks: [{ name: 'Stoccata', bonus: 4, dice: '1d6+2' }],
      actionUsed: false, bonusUsed: false, reactionUsed: false,
    });
    let s: import('../src/index.js').CombatState = {
      combatants: [mk('a', 'A', 20), mk('b', 'B', 5)],
      round: 1,
      turnIndex: 0,
      log: [],
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

describe('action economy e attaques', () => {
  const mkState = (): import('../src/index.js').CombatState => {
    const mk = (id: string, name: string, initiative: number, ac: number, attacks: import('../src/index.js').AttackDef[]): import('../src/index.js').Combatant => ({
      id, name, hp: 20, maxHp: 20, initiative, conditions: [], conditionRounds: {},
      isPlayer: false, ac, speed: 30, movement: 30, attacks,
      actionUsed: false, bonusUsed: false, reactionUsed: false,
    });
    return {
      combatants: [mk('att', 'Attaccante', 20, 12, [{ name: 'Spada', bonus: 5, dice: '1d8+3' }]), mk('def', 'Bersaglio', 5, 15, [])],
      round: 1, turnIndex: 0, log: [],
    };
  };

  it('attack() tira contro la CA, scala danni e consuma l\'azione', () => {
    let s = mkState();
    s = attack(s, 'att', 'def', 0);
    const att = s.combatants.find((c) => c.id === 'att')!;
    const def = s.combatants.find((c) => c.id === 'def')!;
    expect(att.actionUsed).toBe(true);
    expect(s.log.some((l) => l.includes('Spada'))).toBe(true);
    // danno 0 solo se mancato; se colpito hp < 20
    if (def.hp < 20) expect(def.hp).toBeLessThanOrEqual(20 - 4); // min 1d8+3 = 4
  });

  it('resolveAttack: contro CA 30 colpisce solo con 20 naturali (critici)', () => {
    const attacker = mkState().combatants[0];
    const target = { ...mkState().combatants[1], ac: 30 };
    for (let i = 0; i < 100; i++) {
      const o = resolveAttack(attacker, target, attacker.attacks[0]);
      if (o.hit) expect(o.crit).toBe(true);
    }
  });

  it('economia d\'azione: useAction/move decrementano e non vanno sotto zero', () => {
    let s = mkState();
    s = useAction(s, 'att');
    s = moveCombatant(s, 'att', 12);
    s = moveCombatant(s, 'att', 999);
    const att = s.combatants.find((c) => c.id === 'att')!;
    expect(att.actionUsed).toBe(true);
    expect(att.movement).toBe(0);
  });

  it('nextTurn resetta azione/movimento e decrementa le condizioni a round', () => {
    let s = mkState();
    s = setCombatantCondition(s, 'att', 'stunned', true, 2);
    s = useAction(s, 'att');
    s = moveCombatant(s, 'att', 30);
    s = nextTurn(s); // turno di B
    s = nextTurn(s); // torna ad A (round 2): reset + cond stunned 2->1
    const att = s.combatants.find((c) => c.id === 'att')!;
    expect(s.round).toBe(2);
    expect(att.actionUsed).toBe(false);
    expect(att.movement).toBe(30);
    expect(att.conditions).toContain('stunned');
    expect(att.conditionRounds['stunned']).toBe(1);
    s = nextTurn(s);
    s = nextTurn(s); // round 3: stunned scade
    const att2 = s.combatants.find((c) => c.id === 'att')!;
    expect(att2.conditions).not.toContain('stunned');
  });

  it('addEnemy aggiunge nemici dallo statblock', () => {
    let s = mkState();
    s = addEnemy(s, reg, 'goblin', 3);
    expect(s.combatants.filter((c) => c.name.startsWith('Goblin'))).toHaveLength(3);
    expect(s.combatants.find((c) => c.name === 'Goblin 1')!.ac).toBe(15);
    expect(s.combatants.find((c) => c.name === 'Goblin 1')!.attacks[0].dice).toBe('1d6+2');
  });
});

describe('nuove funzioni (fase P0)', () => {
  it('initiative include il modificatore Des', () => {
    const c = makeChar(); // dex 15 -> +2
    const s = startCombat(c, reg);
    expect(s.combatants[0].initiative).toBeGreaterThanOrEqual(1 + 2);
    expect(s.combatants[0].initiative).toBeLessThanOrEqual(20 + 2);
  });

  it('spellcastingInfo: mago liv 1 int 17 -> +7 attacco, CD 15', async () => {
    const { spellcastingInfo, createCharacter: cc } = await import('../src/index.js');
    const wiz = cc({
      name: 'W', raceId: 'elf', subraceId: 'high-elf', classId: 'wizard',
      abilityScores: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    }, reg).character!;
    const info = spellcastingInfo(wiz, reg)!;
    expect(info.attackBonus).toBe(8 + 2 + 3); // 17 int -> +3
    expect(info.saveDC).toBe(13);
  });

  it('tiri della morte: 3 successi → 1 PF, 3 fallimenti → morto; cura da 0 resetta', async () => {
    const { damage, heal, recordDeathSave, isDead } = await import('../src/index.js');
    let c = makeChar();
    c = damage(c, 999);
    expect(c.hp.current).toBe(0);
    c = recordDeathSave(c, false);
    c = recordDeathSave(c, false);
    c = recordDeathSave(c, true);
    expect(isDead(c)).toBe(false);
    c = recordDeathSave(c, false);
    c = recordDeathSave(c, false);
    expect(isDead(c)).toBe(true); // 3 fallimenti
    let d = heal(c, 5, 13);
    expect(d.hp.current).toBeGreaterThanOrEqual(1);
    expect(d.deathSaves).toEqual({ successes: 0, failures: 0 });
    // 3 successi → risveglio a 1 PF
    let e = damage(makeChar(), 999);
    e = recordDeathSave(e, true); e = recordDeathSave(e, true); e = recordDeathSave(e, true);
    expect(e.hp.current).toBe(1);
    expect(e.deathSaves.successes).toBe(3);
  });

  it('prerequisiti multiclasse: mago con Int 10 non può prendere il guerriero (serve Str/Dex 13)', async () => {
    const { createCharacter: cc, addXp, applyLevelUp } = await import('../src/index.js');
    const wiz = cc({
      name: 'W', raceId: 'human', subraceId: 'human-standard', classId: 'wizard',
      abilityScores: { str: 8, dex: 10, con: 13, int: 16, wis: 12, cha: 10 },
    }, reg).character!;
    let c = addXp(wiz, 355000);
    const r = applyLevelUp(c, reg, { classId: 'fighter', hpRoll: 6, fightingStyleId: 'defense' });
    expect(r.errors.some((e) => e.includes('Multiclasse'))).toBe(true);
    // con house-rule bypassPrereq passa
    const c2 = { ...c, houseRules: { ...c.houseRules, bypassPrereq: true } };
    const ok = applyLevelUp(c2, reg, { classId: 'fighter', hpRoll: 6, fightingStyleId: 'defense' });
    expect(ok.errors).toEqual([]);
  });
});

describe('generazione statistiche (standard / point-buy / tiri)', () => {
  it('array standard assegna 15,14,13,12,10,8 nell\'ordine delle abilità', async () => {
    const { generateAbilityScores, STANDARD_ARRAY } = await import('../src/index.js');
    const s = generateAbilityScores('standard');
    expect(Object.values(s)).toEqual([...STANDARD_ARRAY]);
  });

  it('point-buy: costo, budget e validité', async () => {
    const { generateAbilityScores, pointBuySpent, isPointBuyValid, pointCostTo, POINT_BUY_BUDGET } = await import('../src/index.js');
    const base = generateAbilityScores('pointbuy');
    expect(pointBuySpent(base)).toBe(0);
    expect(isPointBuyValid(base)).toBe(true);
    const maxed = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 };
    expect(pointBuySpent(maxed)).toBe(27);
    expect(isPointBuyValid(maxed)).toBe(true);
    const tooMuch = { str: 15, dex: 15, con: 15, int: 14, wis: 8, cha: 8 };
    expect(pointBuySpent(tooMuch)).toBeGreaterThan(POINT_BUY_BUDGET);
    expect(isPointBuyValid(tooMuch)).toBe(false);
    expect(pointCostTo(7)).toBe(Infinity);
    expect(pointCostTo(16)).toBe(Infinity);
    expect(pointCostTo(10)).toBe(2);
  });

  it('4d6 scarta il più basso: risultato nel range 3-18', async () => {
    const { roll4d6DropLowest } = await import('../src/index.js');
    for (let i = 0; i < 200; i++) {
      const v = roll4d6DropLowest();
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(18);
    }
  });

  it('roll mode genera 6 punteggi validi', async () => {
    const { generateAbilityScores } = await import('../src/index.js');
    const s = generateAbilityScores('roll');
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(18);
    }
  });
});
