import { describe, expect, it } from 'vitest';
import { attack, rerollInitiatives, type CombatState } from '../src/index.js';

function mkCombat(targetAc = 14): CombatState {
  return {
    combatants: [
      { id: 'a', name: 'A', hp: 10, maxHp: 10, initiative: 15, conditions: [], conditionRounds: {}, isPlayer: true, ac: 12, speed: 30, movement: 30, attacks: [{ name: 'Spada', bonus: 5, dice: '1d6', type: 'taglio' }], actionUsed: false, bonusUsed: false, reactionUsed: false },
      { id: 'b', name: 'B', hp: 8, maxHp: 8, initiative: 10, conditions: [], conditionRounds: {}, isPlayer: false, ac: targetAc, speed: 30, movement: 30, attacks: [], actionUsed: false, bonusUsed: false, reactionUsed: false },
    ],
    round: 3,
    turnIndex: 0,
    log: [],
  };
}

describe('storico tiri del combattimento (rollHistory)', () => {
  it('attack() registra il tiro di attacco con round, actor e target', () => {
    const s = attack(mkCombat(30), 'a', 'b', 0); // CA 30: sempre mancato, solo il tiro di attacco
    expect(s.rollHistory).toHaveLength(1);
    const r = s.rollHistory![0];
    expect(r.kind).toBe('attack');
    expect(r.round).toBe(3);
    expect(r.actor).toBe('A');
    expect(r.target).toBe('B');
    expect(r.expr).toContain('d20');
    expect(r.rolls).toHaveLength(1);
    expect(r.hit).toBeDefined();
  });

  it('colpendo registra anche il tiro di danno', () => {
    const s = attack(mkCombat(0), 'a', 'b', 0); // CA 0: sempre colpisce
    const kinds = (s.rollHistory ?? []).map((r) => r.kind);
    expect(kinds).toContain('attack');
    expect(kinds).toContain('damage');
    const dmg = (s.rollHistory ?? []).find((r) => r.kind === 'damage')!;
    expect(dmg.total).toBeGreaterThan(0);
    expect(dmg.expr).toContain('1d6');
  });

  it('mancando non registra danni', () => {
    const s = attack(mkCombat(30), 'a', 'b', 0); // CA 30: sempre mancato (max 25)
    expect((s.rollHistory ?? []).every((r) => r.kind === 'attack')).toBe(true);
    expect(s.rollHistory![0].hit).toBe(false);
  });

  it('rerollInitiatives registra un tiro per ogni combattente', () => {
    const s = rerollInitiatives(mkCombat());
    expect(s.rollHistory).toHaveLength(2);
    expect(s.rollHistory!.every((r) => r.kind === 'initiative' && r.expr === '1d20')).toBe(true);
  });

  it('lo storico è cappato a 200 voci (le più vecchie vengono scartate)', () => {
    let s = mkCombat(30);
    for (let i = 0; i < 210; i++) s = attack(s, 'a', 'b', 0);
    expect(s.rollHistory).toHaveLength(200);
  });
});
