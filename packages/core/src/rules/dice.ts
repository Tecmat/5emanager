export interface DicePart {
  count: number;
  faces: number;
  sign: number;
}

export interface ParsedDice {
  dice: DicePart[];
  mod: number;
}

export type AdvantageMode = 'none' | 'advantage' | 'disadvantage';

export interface DiceRollResult {
  expr: string;
  rolls: number[];
  dropped: number[];
  mod: number;
  total: number;
  mode: AdvantageMode;
}

/** tokenizer: termini del tipo [+-]N, [+-]NdM, [+-]dM */
export function parseDice(expr: string): ParsedDice | null {
  const clean = expr.replace(/\s+/g, '').toLowerCase();
  if (!clean) return null;
  const dice: DicePart[] = [];
  let mod = 0;
  let i = 0;
  while (i < clean.length) {
    let sign = 1;
    if (clean[i] === '+' || clean[i] === '-') {
      if (clean[i] === '-') sign = -1;
      i++;
      if (i >= clean.length) return null;
    }
    const rest = clean.slice(i);
    const numMatch = /^\d+/.exec(rest);
    let count = 1;
    if (numMatch) {
      count = Number(numMatch[0]);
      i += numMatch[0].length;
    }
    if (clean[i] === 'd') {
      i++;
      const fMatch = /^\d+/.exec(clean.slice(i));
      if (!fMatch) return null;
      const faces = Number(fMatch[0]);
      i += fMatch[0].length;
      if (count < 1 || count > 100 || faces < 2 || faces > 1000) return null;
      dice.push({ count, faces, sign });
    } else {
      if (!numMatch) return null; // segno senza numero
      mod += sign * count;
    }
  }
  if (dice.length === 0 && mod === 0) return null;
  return { dice, mod };
}

function randomInt(faces: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % faces) + 1;
}

export function rollDice(expr: string, mode: AdvantageMode = 'none'): DiceRollResult | null {
  const parsed = parseDice(expr);
  if (!parsed) return null;
  const rolls: number[] = [];
  const dropped: number[] = [];
  for (const d of parsed.dice) {
    const results: number[] = [];
    for (let i = 0; i < d.count; i++) results.push(d.sign * randomInt(d.faces));
    if (mode !== 'none' && d.faces === 20 && d.count === 1) {
      // vantaggio/svantaggio sul d20: si tira un secondo d20 e si tiene il migliore/peggiore
      const extra = randomInt(20);
      if (mode === 'advantage') {
        if (extra > results[0]) { dropped.push(results[0]); results[0] = extra; }
        else dropped.push(extra);
      } else {
        if (extra < results[0]) { dropped.push(results[0]); results[0] = extra; }
        else dropped.push(extra);
      }
    }
    rolls.push(...results);
  }
  const total = rolls.reduce((a, b) => a + b, 0) + parsed.mod;
  return { expr, rolls, dropped, mod: parsed.mod, total, mode };
}
