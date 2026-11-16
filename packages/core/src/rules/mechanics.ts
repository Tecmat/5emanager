import type { Character, Feature } from '../types.js';
import type { Registry } from '../registry.js';
import { abilityModifier } from './derived.js';

export interface MechanicInfo {
  id: string;
  name: string;
  source: string;
  detail: string;
}

/**
 * Meccaniche sbloccate/scalate con il livello: risorse (usi calcolati), attacchi extra,
 * difesa senz'armatura, dado dell'attacco furtivo, ecc.
 */
export function unlockedMechanics(char: Character, reg: Registry): MechanicInfo[] {
  const byId = new Map<string, MechanicInfo>();
  const order: string[] = [];

  const put = (m: MechanicInfo, level: number) => {
    const prev = byId.get(m.id);
    if (!prev || (prev as MechanicInfo & { level: number }).level < level) {
      (m as MechanicInfo & { level: number }).level = level;
      if (!byId.has(m.id)) order.push(m.id);
      byId.set(m.id, m);
    }
  };

  for (const cl of char.classLevels) {
    const cls = reg.classes.get(cl.classId);
    if (!cls) continue;
    const sources: { feats: { features: Record<number, Feature[]> }; name: string }[] = [
      { feats: cls, name: cls.name },
    ];
    const sub = cl.subclassId ? reg.subclasses.get(cl.subclassId) : undefined;
    if (sub) sources.push({ feats: sub, name: sub.name });

    for (let lvl = 1; lvl <= cl.level; lvl++) {
      for (const src of sources) {
        for (const f of src.feats.features[lvl] ?? []) {
          for (const e of f.effects) {
            if (e.type === 'extraAttack') {
              put({ id: `extra-attack-${cls.id}`, name: 'Attacco Extra', source: `${src.name} ${lvl}`, detail: `${e.count + 1} attacchi con l'azione Attacco` }, lvl);
            } else if (e.type === 'unarmoredDefense') {
              const mod = abilityModifier(char.abilityScores[e.ability]);
              put({ id: `unarmored-${cls.id}-${e.ability}`, name: `Difesa senz'armatura (${e.ability.toUpperCase()})`, source: `${src.name} ${lvl}`, detail: `CA base 10 + Des + ${mod}` }, lvl);
            } else if (e.type === 'resource') {
              const uses = e.uses ?? (e.usesTable ? (e.usesTable[cl.level] ?? 0) : e.usesPerLevel ? e.usesPerLevel * cl.level : 0);
              const rest = [e.shortRest ? 'riposo breve' : null, e.longRest ? 'riposo lungo' : null].filter(Boolean).join(' / ');
              put({ id: `res-${e.id}`, name: e.name, source: `${src.name} ${lvl}`, detail: `${uses > 0 ? `${uses} usi` : '—'}${e.dice ? ` · ${e.dice}` : ''}${rest ? ` · recupera con ${rest}` : ''}` }, lvl);
            } else if (e.type === 'custom') {
              if (e.data && typeof e.data.diceTable === 'object') {
                const table = e.data.diceTable as Record<number, string>;
                const dice = table[cl.level] ?? Object.values(table).at(-1) ?? '';
                put({ id: `scaling-${f.id}`, name: f.name, source: `${src.name} ${lvl}`, detail: `${dice} al livello ${cl.level}` }, lvl);
              } else if (e.data && typeof e.data.damagePerLevel === 'string') {
                const step = typeof e.data.stepEvery === 'number' ? e.data.stepEvery : 2;
                const diceCount = Math.floor((cl.level - 1) / step) + 1;
                const per = e.data.damagePerLevel as string;
                const faces = per.replace(/^\d+d(\d+)$/, '$1');
                put({ id: `scaling-${f.id}`, name: f.name, source: `${src.name} ${lvl}`, detail: `${diceCount}d${faces} danni extra` }, lvl);
              } else {
                put({ id: `custom-${f.id}`, name: f.name, source: `${src.name} ${lvl}`, detail: e.description }, lvl);
              }
            }
          }
        }
      }
    }
  }
  return order.map((id) => byId.get(id)!).filter((m) => m !== undefined);
}
