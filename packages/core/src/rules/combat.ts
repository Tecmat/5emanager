import type { AttackDef, Character } from '../types.js';
import type { Registry } from '../registry.js';
import { rollDice, type AdvantageMode } from './dice.js';
import { armorClass, attackBonus, carryingCapacity, modifierOf } from './derived.js';
import { conditionDef } from './conditions.js';
import { exhaustionEffects } from './exhaustion.js';
import { speedBonusFromEffects } from './effects.js';

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
  /** incantesimo a concentrazione correntemente attivo (id) */
  concentrating?: string;
  speed: number;
  movement: number;
  attacks: AttackDef[];
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
}

export type TemplateShape = 'cone' | 'sphere' | 'line' | 'cube';

/** area/zone mostrata sulla griglia durante il combattimento (misure in piedi, 5 ft = 1 cella) */
export interface CombatTemplate {
  shape: TemplateShape;
  /** lunghezza/raggio/lato in piedi a seconda della forma */
  sizeFt: number;
  /** larghezza della linea in piedi */
  widthFt?: number;
  /** combattente da cui origina il template */
  originId?: string;
  label?: string;
}

/** token sulla mappa tattica: cella (5 ft = 1 cella), angoli in alto a sinistra */
export interface MapToken {
  x: number;
  y: number;
}

/** mappa tattica del combattimento: griglia cols x rows, un token per combattente */
export interface TacticalMap {
  cols: number;
  rows: number;
  tokens: Record<string, MapToken>;
}

export const DEFAULT_MAP_COLS = 16;
export const DEFAULT_MAP_ROWS = 12;

/** un tiro registrato nello storico del combattimento (persistente per tutta la durata del combattimento) */
export interface CombatRoll {
  round: number;
  actor: string;
  target?: string;
  kind: 'attack' | 'damage' | 'initiative';
  expr: string;
  rolls: number[];
  total: number;
  hit?: boolean;
  crit?: boolean;
  at: string;
}

const MAX_ROLL_HISTORY = 200;

/** aggiunge un tiro allo storico (cap 200: i più vecchi vengono scartati) */
function pushRoll(state: CombatState, entry: CombatRoll): CombatState {
  const rollHistory = [...(state.rollHistory ?? []), entry];
  return { ...state, rollHistory: rollHistory.length > MAX_ROLL_HISTORY ? rollHistory.slice(-MAX_ROLL_HISTORY) : rollHistory };
}

export interface CombatState {
  combatants: Combatant[];
  round: number;
  turnIndex: number;
  log: string[];
  /** storico dei tiri (attacchi, danni, initiative) del combattimento */
  rollHistory?: CombatRoll[];
  /** template area correntemente mostrato (cono/sfera/linea/cubo) */
  template?: CombatTemplate;
  /** mappa tattica con i token dei combattenti (sincronizzata via state) */
  map?: TacticalMap;
  /** timer di turno (secondi) impostato dal master: se presente, il countdown parte da turnStartedAt ed è uguale per tutti */
  turnTimerSec?: number;
  /** istante (ISO) di inizio del turno corrente: con turnTimerSec dà il countdown sincronizzato */
  turnStartedAt?: string;
}

/** crea la mappa di default e mette i combattenti senza token in posizioni a griglia */
export function ensureMap(c: CombatState): CombatState {
  if (c.map) return c;
  const cols = DEFAULT_MAP_COLS;
  const rows = DEFAULT_MAP_ROWS;
  const tokens: Record<string, MapToken> = {};
  c.combatants.forEach((cb, i) => {
    tokens[cb.id] = { x: 1 + (i % 6), y: 1 + Math.floor(i / 6) };
  });
  return { ...c, map: { cols, rows, tokens } };
}

/** sposta un token (clamp ai bordi); crea la mappa se mancante */
export function moveToken(c: CombatState, id: string, x: number, y: number): CombatState {
  const withMap = ensureMap(c);
  const m = withMap.map!;
  const cx = Math.max(0, Math.min(m.cols - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(m.rows - 1, Math.round(y)));
  return { ...withMap, map: { ...m, tokens: { ...m.tokens, [id]: { x: cx, y: cy } } } };
}

/** ridimensiona la griglia (clamp dei token dentro) */
export function setMapSize(c: CombatState, cols: number, rows: number): CombatState {
  const withMap = ensureMap(c);
  const m = withMap.map!;
  const nCols = Math.max(4, Math.min(40, Math.round(cols)));
  const nRows = Math.max(4, Math.min(30, Math.round(rows)));
  const tokens: Record<string, MapToken> = {};
  for (const [id, t] of Object.entries(m.tokens)) {
    tokens[id] = { x: Math.max(0, Math.min(nCols - 1, t.x)), y: Math.max(0, Math.min(nRows - 1, t.y)) };
  }
  return { ...withMap, map: { cols: nCols, rows: nRows, tokens } };
}

const DEFAULT_SPEED = 30;

export function startCombat(char: Character, reg?: Registry): CombatState {
  const ac = reg ? armorClass(char, reg).ac : 10;
  const speed = speedOf(char, reg);
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
    initiative: (rollDice('1d20')?.total ?? 10) + modifierOf(char, 'dex'),
    conditions: [...char.conditions],
    conditionRounds: {},
    isPlayer: true,
    ac,
    concentrating: char.concentrationSpellId,
    speed,
    movement: speed,
    attacks,
    actionUsed: false,
    bonusUsed: false,
    reactionUsed: false,
  };
  return ensureMap({ combatants: [player], round: 1, turnIndex: 0, turnStartedAt: new Date().toISOString(), log: [`⚔️ Combattimento iniziato! ${char.name} entra con CA ${ac}.`] });
}

/** combattimento con tutta la party: un combattente per personaggio */
export function startPartyCombat(chars: Character[], reg: Registry): CombatState {
  const combatants: Combatant[] = chars.map((char) => {
    const ac = armorClass(char, reg).ac;
    const speed = speedOf(char, reg);
    const attacks: AttackDef[] = [];
    for (const item of char.inventory) {
      if (!item.equipped || item.kind !== 'weapon' || !item.refId) continue;
      const w = reg.weapons.get(item.refId);
      if (w) attacks.push({ name: w.name, bonus: attackBonus(char, w).bonus, dice: w.damage, type: w.damageType });
    }
    return {
      id: char.id,
      name: char.name,
      hp: char.hp.current,
      maxHp: char.hp.current,
      initiative: (rollDice('1d20')?.total ?? 10) + modifierOf(char, 'dex'),
      conditions: [...char.conditions],
      conditionRounds: {},
      isPlayer: true,
      ac,
      concentrating: char.concentrationSpellId,
      speed,
      movement: speed,
      attacks,
      actionUsed: false,
      bonusUsed: false,
      reactionUsed: false,
    };
  });
  const base: CombatState = {
    combatants: sortByInitiative(combatants),
    round: 1,
    turnIndex: 0,
    turnStartedAt: new Date().toISOString(),
    log: [`⚔️ Combattimento iniziato con ${combatants.length} PG!`],
  };
  return ensureMap(base);
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
  let next: CombatState = { ...state, combatants: sortByInitiative([...state.combatants, c]), log: [...state.log, `➕ ${c.name} entra (init ${c.initiative}, CA ${c.ac}, PF ${c.hp}).`] };
  if (next.map) {
    // token in una cella libera (angolo in alto a destra della griglia)
    const m = next.map;
    let x = m.cols - 2, y = 1;
    const free = new Set<string>();
    for (let yy = 0; yy < m.rows; yy++) for (let xx = 0; xx < m.cols; xx++) free.add(xx + ',' + yy);
    for (const t of Object.values(m.tokens)) free.delete(t.x + ',' + t.y);
    outer: for (let yy = 1; yy < m.rows - 1; yy++) for (let xx = m.cols - 2; xx >= 0; xx--) {
      if (free.has(xx + ',' + yy)) { x = xx; y = yy; break outer; }
    }
    next = { ...next, map: { ...m, tokens: { ...m.tokens, [c.id]: { x, y } } } };
  }
  return next;
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
    map: state.map ? { ...state.map, tokens: Object.fromEntries(Object.entries(state.map.tokens).filter(([k]) => k !== id)) } : undefined,
    turnIndex: Math.min(state.turnIndex, Math.max(0, combatants.length - 1)),
    log: [...state.log, `✕ ${c?.name ?? id} esce dal combattimento.`],
  };
}

function sortByInitiative(list: Combatant[]): Combatant[] {
  return [...list].sort((a, b) => b.initiative - a.initiative);
}

export function rerollInitiatives(state: CombatState): CombatState {
  const at = new Date().toISOString();
  let next: CombatState = { ...state, turnIndex: 0, log: [...state.log, '🎲 Initiative rilanciate.'] };
  const combatants = sortByInitiative(
    state.combatants.map((c) => {
      const total = rollDice('1d20')?.total ?? 10;
      next = pushRoll(next, { round: state.round, actor: c.name, kind: 'initiative', expr: '1d20', rolls: [total], total, at });
      return { ...c, initiative: total };
    }),
  );
  return { ...next, combatants };
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
  return { ...state, combatants, turnIndex, round, log, turnStartedAt: new Date().toISOString() };
}

/**
 * Imposta il timer di turno condiviso (solo il master, via azione setTurnTimer):
 * 0 disattiva il timer (torna a quello locale). Ritorna lo stato con turnTimerSec aggiornato.
 */
export function setTurnTimer(state: CombatState, seconds: number): CombatState {
  const sec = Math.max(0, Math.min(3600, Math.round(seconds)));
  const next = { ...state };
  if (sec <= 0) delete next.turnTimerSec;
  else next.turnTimerSec = sec;
  next.turnStartedAt = new Date().toISOString();
  return next;
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
    if (c.concentrating && amount > 0) {
      const dc = Math.max(10, Math.floor(amount / 2));
      log.push(`🎯 ${c.name} deve superare un tiro salvezza di Costituzione CD ${dc} per mantenere la concentrazione su ${c.concentrating}.`);
    }
    return { ...c, hp };
  });
  return { ...state, combatants, log };
}

/** piazza un template area (cono/sfera/linea/cubo) sul campo di battaglia */
export function setTemplate(state: CombatState, t: CombatTemplate): CombatState {
  const shapeIt: Record<TemplateShape, string> = { cone: 'cono', sphere: 'sfera', line: 'linea', cube: 'cubo' };
  const label = t.label ?? `${shapeIt[t.shape]} ${t.sizeFt} ft`;
  return { ...state, template: { ...t, label }, log: [...state.log, `📐 Template: ${label}${t.originId ? ` (da ${state.combatants.find((c) => c.id === t.originId)?.name ?? t.originId})` : ''}.`] };
}

export function clearTemplate(state: CombatState): CombatState {
  if (!state.template) return state;
  return { ...state, template: undefined, log: [...state.log, '📐 Template rimosso.'] };
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
      const speed = speedOf(char, reg ?? undefined) || c.speed;
      const attacks: AttackDef[] = [];
      if (reg) {
        for (const item of char.inventory) {
          if (!item.equipped || item.kind !== 'weapon' || !item.refId) continue;
          const w = reg.weapons.get(item.refId);
          if (w) attacks.push({ name: w.name, bonus: attackBonus(char, w).bonus, dice: w.damage, type: w.damageType });
        }
      }
      return { ...c, hp: char.hp.current, conditions: [...char.conditions], concentrating: char.concentrationSpellId, ...(ac !== undefined ? { ac } : {}), speed, attacks };
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

export interface AttackMods {
  advantage?: boolean;
  disadvantage?: boolean;
  /** dadi danno extra dagli effetti (es. "1d6" fuoco) */
  extraDamageDice?: string[];
}

/** attacco con tiro automatico: d20 + bonus contro la CA del bersaglio; 20 = critico (dadi raddoppiati) */
export function resolveAttack(attacker: Combatant, target: Combatant, attack: AttackDef, mode: AdvantageMode = 'none', extraDice: string[] = []): AttackOutcome {
  const roll = rollDice('1d20', mode)!;
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
    for (const extra of extraDice) {
      const ex = rollDice(extra);
      if (ex) {
        damageRolls.push(...ex.rolls.map((r) => r * times));
        damage += ex.rolls.reduce((a, b) => a + b, 0) * times + ex.mod;
      }
    }
  }
  return { hit, crit, roll: roll.total, total, damage, damageRolls };
}

export function attack(state: CombatState, attackerId: string, targetId: string, attackIndex = 0, mods?: AttackMods): CombatState {
  const attacker = state.combatants.find((c) => c.id === attackerId);
  const target = state.combatants.find((c) => c.id === targetId);
  if (!attacker || !target) return state;
  const atk = attacker.attacks[attackIndex] ?? attacker.attacks[0];
  if (!atk) return { ...state, log: [...state.log, `⚠️ ${attacker.name} non ha attacchi disponibili.`] };
  // svantaggio da condizioni dell'attaccante + mod del chiamante
  const condDisadvantage = attacker.conditions.some((c) => conditionDef(c)?.imposesDisadvantage);
  const mode: AdvantageMode = mods?.disadvantage || condDisadvantage ? 'disadvantage' : mods?.advantage ? 'advantage' : 'none';
  const outcome = resolveAttack(attacker, target, atk, mode, mods?.extraDamageDice ?? []);
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
  let next: CombatState = { ...state, combatants, log };
  const at = new Date().toISOString();
  const atkExpr = `d20${atk.bonus >= 0 ? '+' : ''}${atk.bonus}${mode !== 'none' ? ` (${mode === 'advantage' ? 'vantaggio' : 'svantaggio'})` : ''}`;
  next = pushRoll(next, { round: state.round, actor: attacker.name, target: target.name, kind: 'attack', expr: atkExpr, rolls: [outcome.roll], total: outcome.total, hit: outcome.hit, crit: outcome.crit, at });
  if (outcome.hit && outcome.damage > 0) {
    const dmgExpr = [atk.dice, ...(mods?.extraDamageDice ?? [])].join('+');
    next = pushRoll(next, { round: state.round, actor: attacker.name, target: target.name, kind: 'damage', expr: dmgExpr, rolls: outcome.damageRolls, total: outcome.damage, at });
  }
  return next;
}

/** velocità effettiva: razza + bonus effetti, dimezzata a esaurimento 2, 0 a esaurimento 5 */
export function speedOf(char: Character, reg?: Registry): number {
  const base = reg?.races.get(char.raceId)?.speed ?? DEFAULT_SPEED;
  const fx = exhaustionEffects(char);
  if (fx.speedZero) return 0;
  let speed = base + (reg ? speedBonusFromEffects(char, reg) : 0);
  if (fx.speedHalved) speed = Math.floor(speed / 2);
  return Math.max(0, speed);
}

export { carryingCapacity };
