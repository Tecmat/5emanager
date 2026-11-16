import type { AttackDef, Character } from '../types.js';
import type { Registry } from '../registry.js';
import { rollDice } from './dice.js';
import { armorClass, attackBonus, carryingCapacity } from './derived.js';

export interface Combatant {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  conditions: string[];
  /** durate in round delle condizioni: id -> round rimanenti */
  conditionRounds: Record<string, number>;
  isPlayer: boolean;
  ac: number;
  speed: number;
  movement: number;
  attacks: AttackDef[];
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
}

export interface CombatState {
  combatants: Combatant[];
  round: number;
  turnIndex: number;
  log: string[];
}

const DEFAULT_SPEED = 30;

export function startCombat(char: Character, reg?: Registry): CombatState {
  const ac = reg ? armorClass(char, reg).ac : 10;
  const race = reg?.races.get(char.raceId);
  const speed = race?.speed ?? DEFAULT_SPEED;
  const attacks: AttackDef[] = [];
  if (reg) {
    for (const item of char.inventory) {
      if (!item.equipped || item.kind !== 'weapon' || !item.refId) continue;
      const w = reg.weapons.get(item.refId);
      if (!w) continue;
      const ab = attackBonus(char, w);
      attacks.push({ name: w.name, bonus: ab.bonus, dice: w.damage, type: w.damageType });
    }
  }
  const player: Combatant = {
    id: char.id,
    name: char.name,
    hp: char.hp.current,
    maxHp: char.hp.current,
    initiative: rollDice('1d20')?.total ?? 10,
    conditions: [...char.conditions],
    conditionRounds: {},
    isPlayer: true,
    ac,
    speed,
    movement: speed,
    attacks,
    actionUsed: false,
    bonusUsed: false,
    reactionUsed: false,
  };
  return { combatants: [player], round: 1, turnIndex: 0, log: [`⚔️ Combattimento iniziato! ${char.name} entra con CA ${ac}.`] };
}

let seq = 0;

function baseCombatant(input: { name: string; hp: number; initiative?: number; ac?: number; speed?: number; attacks?: AttackDef[]; isPlayer?: boolean }): Combatant {
  const speed = input.speed ?? DEFAULT_SPEED;
  return {
    id: input.isPlayer ? input.name : `npc-${Date.now()}-${seq++}`,
    name: input.name,
    hp: input.hp,
    maxHp: input.hp,
    initiative: input.initiative ?? rollDice('1d20')?.total ?? 10,
    conditions: [],
    conditionRounds: {},
    isPlayer: input.isPlayer ?? false,
    ac: input.ac ?? 10,
    speed,
    movement: speed,
    attacks: input.attacks ?? [],
    actionUsed: false,
    bonusUsed: false,
    reactionUsed: false,
  };
}

export function addCombatant(state: CombatState, input: { name: string; hp: number; initiative?: number; ac?: number; speed?: number; attacks?: AttackDef[] }): CombatState {
  const c = baseCombatant(input);
  return { ...state, combatants: sortByInitiative([...state.combatants, c]), log: [...state.log, `➕ ${c.name} entra (init ${c.initiative}, CA ${c.ac}, PF ${c.hp}).`] };
}

/** aggiunge `count` nemici da uno statblock del registry */
export function addEnemy(state: CombatState, reg: Registry, enemyId: string, count = 1): CombatState {
  const enemy = reg.enemies.get(enemyId);
  if (!enemy) return state;
  let next = state;
  for (let i = 0; i < count; i++) {
    const suffix = count > 1 ? ` ${i + 1}` : '';
    next = addCombatant(next, {
      name: enemy.name + suffix,
      hp: enemy.hp,
      ac: enemy.ac,
      speed: enemy.speed,
      attacks: enemy.attacks,
    });
  }
  return next;
}

export function removeCombatant(state: CombatState, id: string): CombatState {
  const c = state.combatants.find((x) => x.id === id);
  const combatants = state.combatants.filter((x) => x.id !== id);
  return {
    ...state,
    combatants,
    turnIndex: Math.min(state.turnIndex, Math.max(0, combatants.length - 1)),
    log: [...state.log, `✕ ${c?.name ?? id} esce dal combattimento.`],
  };
}

function sortByInitiative(list: Combatant[]): Combatant[] {
  return [...list].sort((a, b) => b.initiative - a.initiative);
}

export function rerollInitiatives(state: CombatState): CombatState {
  const combatants = sortByInitiative(state.combatants.map((c) => ({ ...c, initiative: rollDice('1d20')?.total ?? 10 })));
  return { ...state, combatants, turnIndex: 0, log: [...state.log, '🎲 Initiative rilanciate.'] };
}

/**
 * Avanza al turno successivo: resetta l'economia d'azione del nuovo combattente
 * e decrementa le durate delle sue condizioni (a inizio turno).
 */
export function nextTurn(state: CombatState): CombatState {
  if (state.combatants.length === 0) return state;
  let turnIndex = state.turnIndex + 1;
  let round = state.round;
  if (turnIndex >= state.combatants.length) {
    turnIndex = 0;
    round += 1;
  }
  let log = [...state.log];
  const combatants = state.combatants.map((c, i) => {
    if (i !== turnIndex) return c;
    const conditionRounds: Record<string, number> = {};
    const kept: string[] = [];
    for (const cond of c.conditions) {
      const left = (c.conditionRounds[cond] ?? 1) - 1;
      if (left > 0) {
        conditionRounds[cond] = left;
        kept.push(cond);
        log.push(`⏳ ${c.name}: ${cond} (${left} round rimanenti).`);
      } else {
        log.push(`✅ ${c.name}: fine di ${cond}.`);
      }
    }
    return { ...c, actionUsed: false, bonusUsed: false, reactionUsed: false, movement: c.speed, conditions: kept, conditionRounds };
  });
  const cur = combatants[turnIndex];
  if (cur) log.push(`▶️ Round ${round} — turno di ${cur.name} (CA ${cur.ac}, PF ${cur.hp}/${cur.maxHp}).`);
  return { ...state, combatants, turnIndex, round, log };
}

export function currentCombatant(state: CombatState): Combatant | undefined {
  return state.combatants[state.turnIndex];
}

export function damageCombatant(state: CombatState, id: string, amount: number): CombatState {
  const log = [...state.log];
  const combatants = state.combatants.map((c) => {
    if (c.id !== id) return c;
    const hp = Math.max(0, c.hp - amount);
    log.push(`💥 ${c.name} subisce ${amount} danni (${hp}/${c.maxHp} PF).`);
    return { ...c, hp };
  });
  return { ...state, combatants, log };
}

export function healCombatant(state: CombatState, id: string, amount: number): CombatState {
  const log = [...state.log];
  const combatants = state.combatants.map((c) => {
    if (c.id !== id) return c;
    const hp = Math.min(c.maxHp, c.hp + amount);
    log.push(`💚 ${c.name} recupera ${amount} PF (${hp}/${c.maxHp}).`);
    return { ...c, hp };
  });
  return { ...state, combatants, log };
}

export function setCombatantCondition(state: CombatState, id: string, conditionId: string, on: boolean, rounds = 1): CombatState {
  const log = [...state.log];
  const combatants = state.combatants.map((c) => {
    if (c.id !== id) return c;
    let conditions: string[];
    const conditionRounds = { ...c.conditionRounds };
    if (on) {
      conditions = [...new Set([...c.conditions, conditionId])];
      conditionRounds[conditionId] = rounds;
      log.push(`🩸 ${c.name}: ${conditionId} (${rounds} round).`);
    } else {
      conditions = c.conditions.filter((x) => x !== conditionId);
      delete conditionRounds[conditionId];
      log.push(`✨ ${c.name}: guarisce da ${conditionId}.`);
    }
    return { ...c, conditions, conditionRounds };
  });
  return { ...state, combatants, log };
}

export function syncPlayerHp(state: CombatState, char: Character, reg?: Registry): CombatState {
  const ac = reg ? armorClass(char, reg).ac : undefined;
  return {
    ...state,
    combatants: state.combatants.map((c) => {
      if (!c.isPlayer) return c;
      const speed = reg?.races.get(char.raceId)?.speed ?? c.speed;
      const attacks: AttackDef[] = [];
      if (reg) {
        for (const item of char.inventory) {
          if (!item.equipped || item.kind !== 'weapon' || !item.refId) continue;
          const w = reg.weapons.get(item.refId);
          if (w) attacks.push({ name: w.name, bonus: attackBonus(char, w).bonus, dice: w.damage, type: w.damageType });
        }
      }
      return { ...c, hp: char.hp.current, conditions: [...char.conditions], ...(ac !== undefined ? { ac } : {}), speed, attacks };
    }),
  };
}

// --- economia d'azione ---

export function useAction(state: CombatState, id: string): CombatState {
  return { ...state, combatants: state.combatants.map((c) => (c.id === id ? { ...c, actionUsed: true } : c)) };
}
export function useBonus(state: CombatState, id: string): CombatState {
  return { ...state, combatants: state.combatants.map((c) => (c.id === id ? { ...c, bonusUsed: true } : c)) };
}
export function useReaction(state: CombatState, id: string): CombatState {
  return { ...state, combatants: state.combatants.map((c) => (c.id === id ? { ...c, reactionUsed: true } : c)) };
}

/** spende movimento (in piedi); non va sotto zero */
export function moveCombatant(state: CombatState, id: string, amount: number): CombatState {
  const log = [...state.log];
  const combatants = state.combatants.map((c) => {
    if (c.id !== id) return c;
    const movement = Math.max(0, c.movement - amount);
    log.push(`🏃 ${c.name} si muove di ${c.movement - movement} (restano ${movement}).`);
    return { ...c, movement };
  });
  return { ...state, combatants, log };
}

export interface AttackOutcome {
  hit: boolean;
  crit: boolean;
  roll: number;
  total: number;
  damage: number;
  damageRolls: number[];
}

/** attacco con tiro automatico: d20 + bonus contro la CA del bersaglio; 20 = critico (dadi raddoppiati) */
export function resolveAttack(attacker: Combatant, target: Combatant, attack: AttackDef): AttackOutcome {
  const roll = rollDice('1d20')!;
  const crit = roll.rolls[0] === 20;
  const total = roll.total + attack.bonus;
  const hit = crit || total >= target.ac;
  let damage = 0;
  let damageRolls: number[] = [];
  if (hit) {
    const times = crit ? 2 : 1;
    const dmg = rollDice(attack.dice);
    if (dmg) {
      damageRolls = dmg.rolls.map((r) => r * times);
      damage = damageRolls.reduce((a, b) => a + b, 0) + dmg.mod;
    }
  }
  return { hit, crit, roll: roll.total, total, damage, damageRolls };
}

export function attack(state: CombatState, attackerId: string, targetId: string, attackIndex = 0): CombatState {
  const attacker = state.combatants.find((c) => c.id === attackerId);
  const target = state.combatants.find((c) => c.id === targetId);
  if (!attacker || !target) return state;
  const atk = attacker.attacks[attackIndex] ?? attacker.attacks[0];
  if (!atk) return { ...state, log: [...state.log, `⚠️ ${attacker.name} non ha attacchi disponibili.`] };
  const outcome = resolveAttack(attacker, target, atk);
  let log = [...state.log];
  let combatants = state.combatants;
  if (outcome.hit) {
    log.push(`🗡️ ${attacker.name} colpisce ${target.name} con ${atk.name}: d20=${outcome.roll} +${atk.bonus} = ${outcome.total} vs CA ${target.ac}${outcome.crit ? ' — CRITICO!' : ''} → ${outcome.damage} danni (${outcome.damageRolls.join('+')}${outcome.damage > 0 ? '' : ''}).`);
    combatants = combatants.map((c) => (c.id === targetId ? { ...c, hp: Math.max(0, c.hp - outcome.damage) } : c));
    if (combatants.find((c) => c.id === targetId)!.hp <= 0) log.push(`💀 ${target.name} cade a 0 PF!`);
  } else {
    log.push(`🗡️ ${attacker.name} attacca ${target.name} con ${atk.name}: d20=${outcome.roll} +${atk.bonus} = ${outcome.total} vs CA ${target.ac} — mancato.`);
  }
  combatants = combatants.map((c) => (c.id === attackerId ? { ...c, actionUsed: true } : c));
  return { ...state, combatants, log };
}

export function speedOf(char: Character, reg?: Registry): number {
  return reg?.races.get(char.raceId)?.speed ?? DEFAULT_SPEED;
}

export { carryingCapacity };
