import type { Character, Feature, FeatureEffect } from '../types.js';
import type { Registry } from '../registry.js';

/**
 * Mini-DSL degli effetti, interpretato dal core.
 * Forme riconosciute (case-insensitive):
 *   "+2 CA" / "CA +2" / "ac +2"                     -> bonus CA
 *   "advantage: attacks" / "vantaggio: attacchi"    -> vantaggio agli attacchi
 *   "advantage: saves vs magic"                     -> vantaggio ai TS contro magia
 *   "advantage: skill stealth"                      -> vantaggio a una prova di abilità
 *   "advantage: checks"                             -> vantaggio a tutte le prove
 *   "disadvantage: ..."                             -> come advantage ma svantaggio
 *   "+1d6 fire damage"                              -> dado danno extra (tipo facoltativo)
 *   "proficiency: skill stealth" / "proficiency: weapon longsword" / "proficiency: armor light"
 *   "resistance: fire" / "immunity: poison" / "vulnerability: cold"
 *   "speed +10" / "velocità +10"                    -> bonus velocità (piedi)
 *   "darkvision 60"                                 -> scurovisione in piedi
 *   "max hp +2 per level" / "hp +2 per livello"     -> PF massimi extra per livello
 */

export type EffectKind =
  | 'ac' | 'advantage' | 'disadvantage' | 'damage' | 'proficiency'
  | 'resistance' | 'immunity' | 'vulnerability' | 'speed' | 'darkvision' | 'maxHp' | 'unknown';

export interface ParsedEffect {
  kind: EffectKind;
  raw: string;
  value: number;
  /** per advantage/disadvantage: 'attack' | 'save' | 'skill' | 'check' + contesto opzionale (es. 'vs magic') */
  context?: string;
  contextDetail?: string;
  /** per damage: dado es. '1d6' e tipo es. 'fire' */
  dice?: string;
  damageType?: string;
  /** per proficiency: categoria e valore */
  profKind?: 'skill' | 'weapon' | 'armor' | 'tool' | 'savingThrow';
  profValue?: string;
  /** per resistance/immunity/vulnerability */
  damageType2?: string;
}

const ADV_MAP: Record<string, string> = {
  attack: 'attack', attacks: 'attack', attacco: 'attack', attacchi: 'attack',
  save: 'save', saves: 'save', ts: 'save', 'tiro salvation': 'save', 'tiri salvation': 'save',
  skill: 'skill', skills: 'skill', prove: 'skill', 'abilità': 'skill', ability: 'skill', check: 'check', checks: 'check', prove2: 'check',
};

export function parseEffect(raw: string): ParsedEffect | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  let m: RegExpMatchArray | null;

  if ((m = text.match(/^(?:\+\s*)?(\d+)\s*(?:ca|ac)\b/)) || (m = text.match(/\b(?:ca|ac)\s*\+\s*(\d+)/))) {
    return { kind: 'ac', raw, value: Number(m[1]) };
  }
  if ((m = text.match(/^(?:vantaggio|svantaggio|advantage|disadvantage)\s*:?\s*(.+)$/))) {
    const kind = /^(vantaggio|advantage)/.test(text) ? 'advantage' : 'disadvantage';
    let rest = m[1].trim();
    const vs = rest.match(/^(.*?)\s+(?:vs|contro)\s+(.+)$/);
    let detail: string | undefined;
    if (vs) { rest = vs[1].trim(); detail = vs[2].trim(); }
    const key = Object.keys(ADV_MAP).find((k) => rest === k || rest.startsWith(k + ' '));
    const context = key ? ADV_MAP[key] : (rest.includes('skill') || rest.includes('prova') || rest.includes('abilità') ? 'skill' : rest.includes('attack') || rest.includes('attacco') ? 'attack' : rest.includes('save') || rest.includes('ts') ? 'save' : 'check');
    return { kind, raw, value: 1, context, contextDetail: detail };
  }
  if ((m = text.match(/^\+\s*(\d+d\d+(?:\s*\+\s*\d+)?)\s+([a-zà-ÿ]+)?\s*(?:damage|danni)/))) {
    return { kind: 'damage', raw, value: 1, dice: m[1].replace(/\s+/g, ''), damageType: m[2] };
  }
  if ((m = text.match(/^(?:proficienza|proficiency)\s*:?\s*(skill|weapon|armor|armatura|tool|arma|saving\s*throw|ts)?\s*[:\s]*(.+)$/))) {
    const pk = m[1]?.replace(/\s+/g, '') ?? '';
    const profKind: ParsedEffect['profKind'] =
      pk === 'weapon' || pk === 'arma' ? 'weapon'
      : pk === 'armor' || pk === 'armatura' ? 'armor'
      : pk === 'tool' ? 'tool'
      : pk === 'savingthrow' || pk === 'ts' ? 'savingThrow'
      : 'skill';
    return { kind: 'proficiency', raw, value: 1, profKind, profValue: m[2].trim() };
  }
  if ((m = text.match(/^(resistenza|resistance|immunità|immunity|immunita|vulnerabilità|vulnerability|vulnerabilita)\s*:?\s*([a-zà-ÿ-]+)/))) {
    const kind = /resist/.test(m[1]) ? 'resistance' : /immun/.test(m[1]) ? 'immunity' : 'vulnerability';
    return { kind, raw, value: 1, damageType2: m[2].trim() };
  }
  if ((m = text.match(/^(?:velocità|speed)\s*\+\s*(\d+)/))) {
    return { kind: 'speed', raw, value: Number(m[1]) };
  }
  if ((m = text.match(/^(?:darkvision|scurovisione)\s*(\d+)/))) {
    return { kind: 'darkvision', raw, value: Number(m[1]) };
  }
  if ((m = text.match(/^(?:max\s*hp|pf\s*massimi|hp)\s*\+\s*(\d+)\s*(?:per\s*(?:livello|level))?/))) {
    return { kind: 'maxHp', raw, value: Number(m[1]) * (m[2] ? -1 : 1), context: m[2] ? 'perLevel' : undefined };
  }
  return { kind: 'unknown', raw, value: 0 };
}

function featureEffectsOf(f: Feature): FeatureEffect[] {
  return f.effects ?? [];
}

/** raccoglie tutti gli effetti "effect" (DSL) delle feature di classe, sottoclasse e talenti del PG */
export function collectEffects(char: Character, reg: Registry): ParsedEffect[] {
  const out: ParsedEffect[] = [];
  const pushFeature = (f: Feature) => {
    for (const e of featureEffectsOf(f)) {
      if (e.type === 'effect') {
        const p = parseEffect(e.text);
        if (p) out.push(p);
      }
    }
  };
  for (const cl of char.classLevels) {
    const cls = reg.classes.get(cl.classId);
    if (!cls) continue;
    for (let lvl = 1; lvl <= cl.level; lvl++) for (const f of cls.features[lvl] ?? []) pushFeature(f);
    const sub = cl.subclassId ? reg.subclasses.get(cl.subclassId) : undefined;
    if (sub) for (let lvl = 1; lvl <= cl.level; lvl++) for (const f of sub.features[lvl] ?? []) pushFeature(f);
  }
  for (const featId of char.feats) {
    const feat = reg.feats.get(featId);
    if (feat) pushFeature({ id: feat.id, name: feat.name, description: feat.description, effects: feat.effects });
  }
  return out;
}

export function acBonusFromEffects(char: Character, reg: Registry): number {
  return collectEffects(char, reg).filter((e) => e.kind === 'ac').reduce((s, e) => s + e.value, 0);
}

export function maxHpBonusFromEffects(char: Character, reg: Registry): number {
  let bonus = 0;
  for (const e of collectEffects(char, reg)) {
    if (e.kind === 'maxHp') bonus += e.context === 'perLevel' ? -e.value * totalLevelOf(char) : e.value;
  }
  return bonus;
}

function totalLevelOf(char: Character): number {
  return char.classLevels.reduce((s, c) => s + c.level, 0);
}

export type RollContext = 'attack' | 'save' | 'skill' | 'check';

/** true se il PG ha vantaggio nel contesto dato (da effetti DSL) */
export function hasAdvantage(char: Character, reg: Registry, context: RollContext, detail?: string): boolean {
  return collectEffects(char, reg).some((e) => {
    if (e.kind !== 'advantage') return false;
    if (e.context === context || e.context === 'check' && context !== 'attack' && context !== 'save') {
      if (detail && e.contextDetail) return e.contextDetail.includes(detail);
      return true;
    }
    return false;
  });
}

export function hasDisadvantageEffect(char: Character, reg: Registry, context: RollContext, detail?: string): boolean {
  return collectEffects(char, reg).some((e) => {
    if (e.kind !== 'disadvantage') return false;
    if (e.context === context || e.context === 'check') {
      if (detail && e.contextDetail) return e.contextDetail.includes(detail);
      return true;
    }
    return false;
  });
}

/** dadi danno extra dagli effetti (es. "+1d6 fire damage") */
export function damageBonusDice(char: Character, reg: Registry): { dice: string; type?: string }[] {
  return collectEffects(char, reg)
    .filter((e) => e.kind === 'damage' && e.dice)
    .map((e) => ({ dice: e.dice!, type: e.damageType }));
}

export function speedBonusFromEffects(char: Character, reg: Registry): number {
  return collectEffects(char, reg).filter((e) => e.kind === 'speed').reduce((s, e) => s + e.value, 0);
}

export function resistancesFromEffects(char: Character, reg: Registry): { resist: string[]; immune: string[]; vulnerable: string[] } {
  const out = { resist: [] as string[], immune: [] as string[], vulnerable: [] as string[] };
  for (const e of collectEffects(char, reg)) {
    if (e.kind === 'resistance' && e.damageType2) out.resist.push(e.damageType2);
    if (e.kind === 'immunity' && e.damageType2) out.immune.push(e.damageType2);
    if (e.kind === 'vulnerability' && e.damageType2) out.vulnerable.push(e.damageType2);
  }
  return out;
}

/** applica le competenze degli effetti DSL al personaggio (chiamato da derived per proficiency) */
export function proficiencyFromEffects(char: Character, reg: Registry): { skills: string[]; weapons: string[]; armors: string[]; tools: string[]; saves: string[] } {
  const out = { skills: [] as string[], weapons: [] as string[], armors: [] as string[], tools: [] as string[], saves: [] as string[] };
  for (const e of collectEffects(char, reg)) {
    if (e.kind !== 'proficiency' || !e.profValue) continue;
    const v = e.profValue.toLowerCase();
    if (e.profKind === 'skill') out.skills.push(v);
    else if (e.profKind === 'weapon') out.weapons.push(v);
    else if (e.profKind === 'armor') out.armors.push(v);
    else if (e.profKind === 'tool') out.tools.push(v);
    else if (e.profKind === 'savingThrow') out.saves.push(v);
  }
  return out;
}
