import { describe, expect, it } from 'vitest';
import {
  applyCampaignAction,
  createRegistry,
  nextTurn,
  setTurnTimer,
  type Campaign,
  type CombatState,
} from '../src/index.js';

function mkCombat(): CombatState {
  return {
    combatants: [
      { id: 'a', name: 'A', hp: 10, maxHp: 10, initiative: 15, conditions: [], conditionRounds: {}, isPlayer: true, ac: 12, speed: 30, movement: 30, attacks: [], actionUsed: false, bonusUsed: false, reactionUsed: false },
      { id: 'b', name: 'B', hp: 8, maxHp: 8, initiative: 10, conditions: [], conditionRounds: {}, isPlayer: false, ac: 14, speed: 30, movement: 30, attacks: [], actionUsed: false, bonusUsed: false, reactionUsed: false },
    ],
    round: 1,
    turnIndex: 0,
    log: [],
  };
}

function camp(): Campaign {
  return {
    id: 'c1',
    name: 'Test',
    passwordHash: '',
    houseRules: {} as never,
    custom: {},
    players: [
      { id: 'm', name: 'Master', role: 'master' },
      { id: 'p1', name: 'Eroe', role: 'player' },
    ],
    characters: {},
    combat: mkCombat(),
    groupInventory: [],
    groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: '',
    chat: [],
    stats: {} as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Campaign;
}

describe('timer di turno (sincronizzato in combat)', () => {
  it('nextTurn imposta turnStartedAt (countdown riparte a ogni turno)', () => {
    const before = Date.now() - 5000;
    const c = mkCombat();
    const n = nextTurn(c);
    expect(n.turnStartedAt).toBeTruthy();
    expect(new Date(n.turnStartedAt!).getTime()).toBeGreaterThanOrEqual(before);
    expect(n.turnIndex).toBe(1);
    expect(n.round).toBe(1);
    const n2 = nextTurn(n);
    expect(n2.turnIndex).toBe(0);
    expect(n2.round).toBe(2);
    expect(new Date(n2.turnStartedAt!).getTime()).toBeGreaterThanOrEqual(new Date(n.turnStartedAt!).getTime());
  });

  it('setTurnTimer: imposta, limita 0..3600 e azzera turnStartedAt; 0 disattiva', () => {
    const c = mkCombat();
    const t = setTurnTimer(c, 90);
    expect(t.turnTimerSec).toBe(90);
    expect(t.turnStartedAt).toBeTruthy();
    expect(setTurnTimer(c, 99999).turnTimerSec).toBe(3600);
    expect(setTurnTimer(c, -5).turnTimerSec).toBeUndefined();
    expect(setTurnTimer(c, 0).turnTimerSec).toBeUndefined();
  });

  it('azione setTurnTimer: solo il master, solo in combattimento', () => {
    const reg = createRegistry();
    const [ok, err] = applyCampaignAction(camp(), 'm', reg, { kind: 'setTurnTimer', seconds: 45 });
    expect(err).toBeUndefined();
    expect(ok.combat?.turnTimerSec).toBe(45);
    const [no, err2] = applyCampaignAction(camp(), 'p1', reg, { kind: 'setTurnTimer', seconds: 45 });
    expect(no.combat?.turnTimerSec).toBeUndefined();
    expect(err2).toMatch(/master/);
    const c2 = camp();
    c2.combat = null;
    const [, err3] = applyCampaignAction(c2, 'm', reg, { kind: 'setTurnTimer', seconds: 45 });
    expect(err3).toMatch(/Nessun combattimento/);
  });
});
