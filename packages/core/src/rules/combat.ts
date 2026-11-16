import type { Character } from '../types.js';
import { rollDice } from './dice.js';

export interface Combatant {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  conditions: string[];
  isPlayer: boolean;
}

export interface CombatState {
  combatants: Combatant[];
  round: number;
  turnIndex: number;
}

export function startCombat(char: Character): CombatState {
  const init = rollDice('1d20', char.conditions.includes('prone') ? 'none' : 'none')?.total ?? 10;
  const player: Combatant = {
    id: char.id,
    name: char.name,
    hp: char.hp.current,
    maxHp: char.hp.current,
    initiative: init,
    conditions: [...char.conditions],
    isPlayer: true,
  };
  return { combatants: [player], round: 1, turnIndex: 0 };
}

let seq = 0;

export function addCombatant(state: CombatState, input: { name: string; hp: number; initiative?: number }): CombatState {
  const c: Combatant = {
    id: `npc-${Date.now()}-${seq++}`,
    name: input.name,
    hp: input.hp,
    maxHp: input.hp,
    initiative: input.initiative ?? rollDice('1d20')?.total ?? 10,
    conditions: [],
    isPlayer: false,
  };
  return { ...state, combatants: sortByInitiative([...state.combatants, c]) };
}

export function removeCombatant(state: CombatState, id: string): CombatState {
  const combatants = state.combatants.filter((c) => c.id !== id);
  return { ...state, combatants, turnIndex: Math.min(state.turnIndex, Math.max(0, combatants.length - 1)) };
}

function sortByInitiative(list: Combatant[]): Combatant[] {
  return [...list].sort((a, b) => b.initiative - a.initiative);
}

export function rerollInitiatives(state: CombatState): CombatState {
  return { ...state, combatants: sortByInitiative(state.combatants.map((c) => ({ ...c, initiative: rollDice('1d20')?.total ?? 10 }))), turnIndex: 0 };
}

export function nextTurn(state: CombatState): CombatState {
  if (state.combatants.length === 0) return state;
  let turnIndex = state.turnIndex + 1;
  let round = state.round;
  if (turnIndex >= state.combatants.length) {
    turnIndex = 0;
    round += 1;
  }
  return { ...state, turnIndex, round };
}

export function currentCombatant(state: CombatState): Combatant | undefined {
  return state.combatants[state.turnIndex];
}

export function damageCombatant(state: CombatState, id: string, amount: number): CombatState {
  return {
    ...state,
    combatants: state.combatants.map((c) => (c.id === id ? { ...c, hp: Math.max(0, c.hp - amount) } : c)),
  };
}

export function healCombatant(state: CombatState, id: string, amount: number): CombatState {
  return {
    ...state,
    combatants: state.combatants.map((c) => (c.id === id ? { ...c, hp: Math.min(c.maxHp, c.hp + amount) } : c)),
  };
}

export function setCombatantCondition(state: CombatState, id: string, conditionId: string, on: boolean): CombatState {
  return {
    ...state,
    combatants: state.combatants.map((c) => {
      if (c.id !== id) return c;
      const conditions = on ? [...new Set([...c.conditions, conditionId])] : c.conditions.filter((x) => x !== conditionId);
      return { ...c, conditions };
    }),
  };
}

export function syncPlayerHp(state: CombatState, char: Character): CombatState {
  return {
    ...state,
    combatants: state.combatants.map((c) => (c.isPlayer ? { ...c, hp: char.hp.current, conditions: [...char.conditions] } : c)),
  };
}
