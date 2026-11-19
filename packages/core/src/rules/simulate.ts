import type { Ability, Character } from '../types.js';
import type { Registry } from '../registry.js';
import { applyLevelUp, xpForLevel } from './levelup.js';
import { addXp } from '../character.js';
import { totalLevel } from './derived.js';

export interface SimulateLevel {
  level: number;
  classId: string;
  errors: string[];
}

export interface SimulateResult {
  character: Character;
  errors: string[];
  levels: SimulateLevel[];
}

/**
 * Porta il PG al livello 20 con level-up automatici (PF medi, ASI automatico sulla
 * caratteristica primaria, niente talenti/sottoclassi scelti a mano).
 * Utile per validare contenuti custom: una classe che non riesce a salire fino al 20
 * senza errori è sospetta.
 */
export function simulateTo20(char: Character, reg: Registry, classId?: string): SimulateResult {
  const errors: string[] = [];
  const levels: SimulateLevel[] = [];
  let cur: Character = { ...char, houseRules: { ...char.houseRules, bypassXpCheck: true } };
  const target = classId ?? cur.classLevels[0]?.classId;
  if (!target) return { character: cur, errors: ['Nessuna classe sul personaggio'], levels };
  const cls = reg.classes.get(target);
  const primary: Ability =
    (cls?.spellcasting?.ability as Ability | undefined) ??
    ((Object.entries(cur.abilityScores).sort((a, b) => b[1] - a[1])[0]?.[0] as Ability | undefined) ?? 'str');
  // archetipo automatico: il primo disponibile per la classe, al livello richiesto
  const subs = [...reg.subclasses.values()].filter((s) => s.classId === target).sort((a, b) => a.id.localeCompare(b.id));
  const subLevel = subs.length ? Math.min(...subs.flatMap((s) => Object.keys(s.features).map(Number))) : Infinity;
  /** distribuisce i punti ASI: prima l'abilità primaria, poi le altre con più spazio (mai oltre 20, max +2 per voce) */
  const pickAsi = (c: Character, preferred: Ability, points: number): Partial<Record<Ability, number>> => {
    const room = (ab: Ability) => 20 - c.abilityScores[ab];
    const out: Partial<Record<Ability, number>> = {};
    let left = points;
    const order = [preferred, ...(Object.keys(c.abilityScores) as Ability[]).filter((a) => a !== preferred).sort((a, b) => room(b) - room(a))];
    for (const ab of order) {
      if (left <= 0) break;
      const put = Math.min(left, room(ab), 2);
      if (put > 0) { out[ab] = (out[ab] ?? 0) + put; left -= put; }
    }
    return out;
  };
  let guard = 0;
  while (totalLevel(cur) < 20 && guard++ < 30) {
    const cl = cur.classLevels.find((c) => c.classId === target);
    const newLevel = (cl?.level ?? 0) + 1;
    const asiPoints = (cls?.features[newLevel] ?? [])
      .flatMap((f) => f.effects)
      .filter((e) => e.type === 'asi')
      .reduce((a, e) => a + (e as { points: number }).points, 0);
    const asi: Partial<Record<Ability, number>> | undefined = asiPoints > 0 ? pickAsi(cur, primary, asiPoints) : undefined;
    const subclassId = !cl?.subclassId && newLevel >= subLevel && subs.length ? subs[0].id : undefined;
    // stile di combattimento richiesto a questo livello (es. paladino/ranger al liv 2): primo disponibile
    const styleEffect = (cls?.features[newLevel] ?? []).flatMap((f) => f.effects).find((e) => e.type === 'fightingStyle') as { options: string[] } | undefined;
    const fightingStyleId = styleEffect && !cur.fightingStyles.length ? styleEffect.options[0] : undefined;
    const res = applyLevelUp(cur, reg, { classId: target, asi, subclassId, fightingStyleId });
    if (res.errors.length > 0) {
      errors.push(...res.errors.map((e) => `Liv ${newLevel} (${target}): ${e}`));
      levels.push({ level: newLevel, classId: target, errors: res.errors });
      break;
    }
    cur = res.character;
    const need = xpForLevel(totalLevel(cur) + 1);
    if (cur.xp < need) cur = addXp(cur, need - cur.xp);
    levels.push({ level: totalLevel(cur), classId: target, errors: [] });
  }
  if (totalLevel(cur) < 20 && errors.length === 0) errors.push('Simulazione interrotta prima del livello 20');
  return { character: cur, errors, levels };
}
