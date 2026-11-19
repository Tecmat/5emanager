import type { Ability, Character, ClassDef, Feature, SpellSlotState } from '../types.js';
import type { Registry } from '../registry.js';
import { totalLevel, maxHp } from './derived.js';
import { logJournal } from '../character.js';

export const XP_TABLE = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 295000, 355000,
];

export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < XP_TABLE.length; i++) {
    if (xp >= XP_TABLE[i]) level = i + 1;
  }
  return level;
}

export function xpForLevel(level: number): number {
  return XP_TABLE[Math.min(Math.max(1, level), 20) - 1];
}

export function canLevelUp(char: Character): boolean {
  return levelForXp(char.xp) > totalLevel(char) && totalLevel(char) < 20;
}

/** tabella slot del full caster per livello di caster 1-20 (indice 0 = slot di 1° livello) */
export const FULL_CASTER_SLOTS: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2],
  [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

export interface CasterInfo {
  classId: string;
  ability: Ability;
  casterLevel: number;
  type: 'full' | 'half' | 'third' | 'pact';
  prepare: boolean;
  slots: Record<number, SpellSlotState>;
}

/** livello da caster ai fini degli slot in multiclasse (regola PHB) */
export function casterLevel(char: Character, reg: Registry): number {
  let full = 0;
  let half = 0;
  let third = 0;
  let halfUp = 0;
  for (const cl of char.classLevels) {
    const cls = reg.classes.get(cl.classId);
    const sc = cls?.spellcasting;
    if (!sc || cl.level === 0) continue;
    if (sc.type === 'full') full += cl.level;
    else if (sc.type === 'half') (sc.roundUp ? (halfUp += cl.level) : (half += cl.level));
    else if (sc.type === 'third') third += cl.level;
  }
  return full + Math.floor(half / 2) + Math.ceil(halfUp / 2) + Math.floor(third / 3);
}

/** ricalcola gli slot totali preservando quelli usati */
export function computeSpellSlots(char: Character, reg: Registry): Record<number, SpellSlotState> {
  const result: Record<number, SpellSlotState> = {};
  const hasPact = char.classLevels.some((cl) => reg.classes.get(cl.classId)?.spellcasting?.type === 'pact');
  const cLevel = casterLevel(char, reg);
  const singleCaster = char.classLevels.filter((cl) => {
    const sc = reg.classes.get(cl.classId)?.spellcasting;
    return sc && sc.type !== 'pact';
  });

  if (singleCaster.length === 1 && !hasPact) {
    const cl = singleCaster[0];
    const sc = reg.classes.get(cl.classId)!.spellcasting!;
    const table = sc.slots[cl.level] ?? [];
    for (let i = 0; i < table.length; i++) {
      const total = table[i];
      const prev = char.spellSlots[i + 1];
      result[i + 1] = { total, used: Math.min(prev?.used ?? 0, total) };
    }
    return result;
  }

  if (cLevel > 0) {
    const table = FULL_CASTER_SLOTS[cLevel - 1] ?? [];
    for (let i = 0; i < table.length; i++) {
      const total = table[i];
      const prev = char.spellSlots[i + 1];
      result[i + 1] = { total, used: Math.min(prev?.used ?? 0, total) };
    }
  }
  for (const cl of char.classLevels) {
    const sc = reg.classes.get(cl.classId)?.spellcasting;
    if (sc?.type === 'pact') {
      const table = sc.slots[cl.level] ?? [];
      for (let i = 0; i < table.length; i++) {
        const key = 10 + i + 1; // slot di patto marcati oltre 9
        const prev = char.spellSlots[key];
        result[key] = { total: table[i], used: Math.min(prev?.used ?? 0, table[i]) };
      }
    }
  }
  return result;
}

export function cantripsKnown(char: Character, reg: Registry): number {
  let total = 0;
  for (const cl of char.classLevels) {
    const sc = reg.classes.get(cl.classId)?.spellcasting;
    if (!sc) continue;
    for (let lvl = 1; lvl <= cl.level; lvl++) {
      total += sc.cantrips[lvl] ?? 0;
    }
  }
  return total;
}

export interface LevelUpChoices {
  classId: string;
  /** valore tirato per il dado vita (1..hitDie). Se assente usa la media +1 */
  hpRoll?: number;
  /** aumenti di caratteristica: somma totale deve essere 2, ogni voce max +2, max 20 */
  asi?: Partial<Record<Ability, number>>;
  featId?: string;
  fightingStyleId?: string;
  subclassId?: string;
  expertiseSkills?: string[];
  skillChoices?: string[];
}

export interface LevelUpResult {
  character: Character;
  grantedFeatures: Feature[];
  errors: string[];
}

export function applyLevelUp(char: Character, reg: Registry, choices: LevelUpChoices): LevelUpResult {
  const errors: string[] = [];
  const cls: ClassDef | undefined = reg.classes.get(choices.classId);
  if (!cls) return { character: char, grantedFeatures: [], errors: ['Classe non trovata: ' + choices.classId] };

  const current = totalLevel(char);
  if (current >= 20 && !char.houseRules.bypassLevelCap) errors.push('Livello massimo (20) raggiunto');
  if (!char.houseRules.bypassXpCheck && levelForXp(char.xp) <= current) errors.push('XP insufficienti per salire di livello');

  let cl = char.classLevels.find((c) => c.classId === choices.classId);
  const isNewClass = !cl && char.classLevels.length > 0;
  if (isNewClass && !char.houseRules.bypassPrereq) {
    if (cls.multiclassPrereq) {
      for (const [ab, min] of Object.entries(cls.multiclassPrereq) as [Ability, number][]) {
        if (char.abilityScores[ab] < min) errors.push(`Multiclasse in ${cls.name}: richiede ${ab.toUpperCase()} ${min} (hai ${char.abilityScores[ab]})`);
      }
    }
    if (cls.multiclassPrereqAny) {
      const any = Object.entries(cls.multiclassPrereqAny).some(([ab, min]) => char.abilityScores[ab as Ability] >= (min as number));
      if (!any) errors.push(`Multiclasse in ${cls.name}: richiede almeno una tra ${Object.entries(cls.multiclassPrereqAny).map(([ab, min]) => `${ab.toUpperCase()} ${min}`).join(', ')}`);
    }
  }
  const newLevel = (cl?.level ?? 0) + 1;
  if (newLevel > 20 && !char.houseRules.bypassLevelCap) errors.push('La classe non può superare il livello 20');
  if (errors.length > 0) return { character: char, grantedFeatures: [], errors };

  const next: Character = {
    ...char,
    abilityScores: { ...char.abilityScores },
    classLevels: char.classLevels.map((c) => ({ ...c, hitDiceRolled: [...c.hitDiceRolled] })),
    proficiency: {
      skills: [...char.proficiency.skills],
      expertise: [...char.proficiency.expertise],
      weapons: [...char.proficiency.weapons],
      armors: [...char.proficiency.armors],
      tools: [...char.proficiency.tools],
      languages: [...char.proficiency.languages],
    },
    fightingStyles: [...char.fightingStyles],
    feats: [...char.feats],
    features: [...char.features],
  };
  if (cl) {
    cl = next.classLevels.find((c) => c.classId === choices.classId)!;
    cl.level = newLevel;
  } else {
    next.classLevels.push({ classId: choices.classId, level: newLevel, hitDiceRolled: [] });
  }
  const target = next.classLevels.find((c) => c.classId === choices.classId)!;

  // dado vita
  let roll = choices.hpRoll;
  if (roll === undefined) roll = Math.floor(cls.hitDie / 2) + 1; // media arrotondata per eccesso
  if (roll < 1 || roll > cls.hitDie) {
    errors.push(`Tiro dado vita non valido: ${roll} (1-${cls.hitDie})`);
    return { character: char, grantedFeatures: [], errors };
  }
  target.hitDiceRolled.push(roll);

  // feature del nuovo livello (classe + sottoclasse)
  const granted: Feature[] = [];
  const classFeatures = cls.features[newLevel] ?? [];
  for (const f of classFeatures) granted.push({ ...f, source: `${cls.name} ${newLevel}` });

  for (const f of classFeatures) {
    const hasFeat = f.effects.some((e) => e.type === 'feat');
    const wantsFeat = hasFeat && choices.featId !== undefined;
    for (const e of f.effects) {
      if (e.type === 'asi') {
        if (wantsFeat) continue; // a questo livello si è scelto il talento al posto dell'ASI
        const asi = choices.asi ?? {};
        const sum = Object.values(asi).reduce((a, b) => a + b, 0);
        if (sum !== e.points) errors.push(`ASI: richiesti ${e.points} punti, forniti ${sum}`);
        for (const [ab, pts] of Object.entries(asi) as [Ability, number][]) {
          if (pts < 0 || pts > 2) errors.push(`ASI: ${ab} può aumentare al massimo di 2`);
          const newScore = next.abilityScores[ab] + pts;
          if (newScore > 20 && !char.houseRules.bypassAsiCap) errors.push(`ASI: ${ab} supererebbe 20`);
          next.abilityScores[ab] = char.houseRules.bypassAsiCap ? newScore : Math.min(20, newScore);
        }
      } else if (e.type === 'feat') {
        if (!wantsFeat) continue;
        const feat = reg.feats.get(choices.featId!);
        if (!feat) errors.push('Talento non trovato: ' + choices.featId);
        else {
          next.feats.push(feat.id);
          for (const fe of feat.effects) {
            if (fe.type === 'asi') {
              const ab = cls.primaryAbility[0] ?? 'str';
              next.abilityScores[ab] = Math.min(20, next.abilityScores[ab] + (fe.points > 1 ? 2 : 1));
            } else if (fe.type === 'proficiency') {
              applyProficiency(next, fe);
            }
          }
        }
      } else if (e.type === 'fightingStyle') {
        if (choices.fightingStyleId) {
          if (!e.options.includes(choices.fightingStyleId) && !reg.fightingStyles.has(choices.fightingStyleId)) {
            errors.push('Stile di combattimento non valido: ' + choices.fightingStyleId);
          }
          next.fightingStyles.push(choices.fightingStyleId);
        } else {
          errors.push(`Richiesto stile di combattimento per ${f.name}`);
        }
      } else if (e.type === 'subclass') {
        if (choices.subclassId) {
          const sub = reg.subclasses.get(choices.subclassId);
          if (!sub || sub.classId !== choices.classId) errors.push('Archetipo non valido per questa classe: ' + choices.subclassId);
          else {
            target.subclassId = sub.id;
            const subFeatures = sub.features[newLevel] ?? [];
            for (const sf of subFeatures) granted.push({ ...sf, source: `${sub.name} ${newLevel}` });
          }
        } else {
          errors.push(`Richiesto archetipo (sottoclasse) per ${f.name}`);
        }
      } else if (e.type === 'expertise') {
        const chosen = choices.expertiseSkills ?? [];
        for (const s of chosen.slice(0, e.choose)) {
          if (!next.proficiency.expertise.includes(s)) next.proficiency.expertise.push(s);
          if (!next.proficiency.skills.includes(s)) next.proficiency.skills.push(s);
        }
      } else if (e.type === 'proficiency') {
        applyProficiency(next, e);
      }
    }
  }

  // sottoclasse: feature dei livelli intermedi
  if (target.subclassId) {
    const sub = reg.subclasses.get(target.subclassId);
    if (sub) {
      for (const sf of sub.features[newLevel] ?? []) granted.push({ ...sf, source: `${sub.name} ${newLevel}` });
    }
  }

  // aggiorna slot incantesimo e HP
  next.spellSlots = computeSpellSlots(next, reg);
  const newMax = maxHp(next, reg);
  next.hp = { current: Math.min(newMax, next.hp.current + (newMax - maxHp(char, reg))), temp: next.hp.temp };

  for (const f of granted) {
    if (!next.features.includes(f.id)) next.features.push(f.id);
  }
  next.updatedAt = new Date().toISOString();

  if (errors.length > 0) return { character: char, grantedFeatures: [], errors };
  return { character: logJournal(next, `Sale al livello ${totalLevel(next)} (${cls.name} ${newLevel})`), grantedFeatures: granted, errors: [] };
}

function applyProficiency(char: Character, e: { type: 'proficiency'; kind: string; value: string }): void {
  const p = char.proficiency;
  switch (e.kind) {
    case 'skill': if (!p.skills.includes(e.value)) p.skills.push(e.value); break;
    case 'weapon': if (!p.weapons.includes(e.value)) p.weapons.push(e.value); break;
    case 'armor': if (!p.armors.includes(e.value)) p.armors.push(e.value); break;
    case 'tool': if (!p.tools.includes(e.value)) p.tools.push(e.value); break;
    case 'language': if (!p.languages.includes(e.value)) p.languages.push(e.value); break;
  }
}
