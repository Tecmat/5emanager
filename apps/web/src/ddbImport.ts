import { applyLevelUp, createCharacter, type Ability, type Character, type Registry } from '@dnd5e/core';

/**
 * Import best-effort da un export JSON di D&D Beyond (solo dati propri dell'utente).
 * Riconosce la struttura classica `data`/`character` con name, classes, race, subrace, stats.
 * Le 12 classi e le 9 razze SRD base sono mappate da nome (EN/IT); il resto viene segnalato
 * negli avvisi invece di bloccare l'import.
 */

const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const CLASS_MAP: Record<string, string> = {
  barbarian: 'barbarian', bard: 'bard', cleric: 'cleric', druid: 'druid', fighter: 'fighter', monk: 'monk',
  paladin: 'paladin', ranger: 'ranger', rogue: 'rogue', sorcerer: 'sorcerer', warlock: 'warlock', wizard: 'wizard',
  barbaro: 'barbarian', bardo: 'bard', chierico: 'cleric', druido: 'druid', guerriero: 'fighter', monaco: 'monk',
  paladino: 'paladin', ladro: 'rogue', stregone: 'sorcerer', mago: 'wizard',
};

const RACE_MAP: Record<string, string> = {
  human: 'human', elf: 'elf', dwarf: 'dwarf', halfling: 'halfling', dragonborn: 'dragonborn',
  gnome: 'gnome', 'half elf': 'half-elf', 'half orc': 'half-orc', tiefling: 'tiefling',
  umano: 'human', elfo: 'elf', nano: 'dwarf', mezzelfo: 'half-elf', mezzorco: 'half-orc', dragonide: 'dragonborn', gnomo: 'gnome',
};

const SUBRACE_MAP: Record<string, string> = {
  'high elf': 'high-elf', 'alto elfo': 'high-elf', 'wood elf': 'wood-elf', 'elfo dei boschi': 'wood-elf',
  'dark elf': 'drow', drow: 'drow', 'hill dwarf': 'hill-dwarf', 'nano delle colline': 'hill-dwarf',
  'mountain dwarf': 'mountain-dwarf', 'nano delle montagne': 'mountain-dwarf',
  lightfoot: 'lightfoot', piedeleggero: 'lightfoot', stout: 'stout', tarchiato: 'stout',
  'forest gnome': 'forest-gnome', 'gnomo della foresta': 'forest-gnome', 'rock gnome': 'rock-gnome', 'gnomo delle rocce': 'rock-gnome',
};

const STAT_IDS: Record<number, Ability> = { 1: 'str', 2: 'dex', 3: 'con', 4: 'int', 5: 'wis', 6: 'cha' };

export interface DdbImportResult {
  character?: Character;
  errors: string[];
  warnings: string[];
}

export function parseDdbJson(text: string, reg: Registry): DdbImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { errors: ['File non valido: non è JSON'], warnings };
  }
  const top = obj as Record<string, unknown>;
  const d = ((top?.data ?? top?.character ?? top) ?? {}) as Record<string, unknown>;
  if (!d || typeof d !== 'object' || !d.name) {
    return { errors: ['Formato non riconosciuto: manca il nome del personaggio (atteso un export D&D Beyond con data.name)'], warnings };
  }
  const name = String(d.name);

  const classes = Array.isArray(d.classes) ? d.classes : [];
  const parsed = classes
    .map((c) => {
      const def = ((c as Record<string, unknown>)?.definition ?? c) as Record<string, unknown>;
      return { name: String(def?.name ?? ''), level: Number(def?.level ?? 1) || 1 };
    })
    .filter((c) => c.name);
  if (!parsed.length) return { errors: [...errors, 'Nessuna classe trovata in data.classes'], warnings };
  parsed.sort((a, b) => b.level - a.level);
  const main = parsed[0];
  const classId = CLASS_MAP[norm(main.name)];
  if (!classId) return { errors: [`Classe non supportata: "${main.name}" (supportate: le 12 classi SRD base)`], warnings };
  if (parsed.length > 1) {
    warnings.push(`Multiclasse: importata la classe principale "${main.name}" liv ${main.level}; ignorate: ${parsed.slice(1).map((c) => `${c.name} liv ${c.level}`).join(', ')}`);
  }

  const raceObj = d.race as Record<string, unknown> | undefined;
  const raceRaw = raceObj?.fullName ?? raceObj?.name ?? d.race;
  const subObj = d.subrace as Record<string, unknown> | undefined;
  const subRaw = subObj?.fullName ?? subObj?.name ?? '';
  const raceId = RACE_MAP[norm(String(raceRaw ?? ''))];
  if (!raceId) return { errors: [`Razza non supportata: "${raceRaw}" (supportate: le 9 razze SRD base)`], warnings };
  let subraceId: string | undefined;
  if (subRaw) {
    subraceId = SUBRACE_MAP[norm(String(subRaw))];
    const race = reg.races.get(raceId);
    if (!subraceId) warnings.push(`Sottorazza non riconosciuta: "${subRaw}" (importato senza sottorazza)`);
    else if (race && !race.subraces.some((s) => s.id === subraceId)) {
      warnings.push(`Sottorazza "${subRaw}" non valida per ${race.name}: importato senza sottorazza`);
      subraceId = undefined;
    }
  }

  const abilities: Record<Ability, number> = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const stats = Array.isArray(d.stats) ? d.stats : Array.isArray(d.abilities) ? d.abilities : [];
  let foundStats = false;
  for (const st of stats) {
    const s = st as Record<string, unknown>;
    const id = Number(s.id);
    const val = Number(s.value ?? s.score);
    if (STAT_IDS[id] && Number.isFinite(val)) {
      abilities[STAT_IDS[id]] = Math.max(1, Math.min(30, val));
      foundStats = true;
    }
  }
  if (!foundStats) warnings.push('Caratteristiche non trovate nell\'export: usati i valori standard (10)');

  const cls = reg.classes.get(classId);
  const styleOptions = (cls?.features[1] ?? []).flatMap((f) => f.effects).flatMap((e) => (e.type === 'fightingStyle' ? e.options : []));

  // livello = livello della classe principale (il multiclasse resta un avviso)
  const totalLevel = Math.max(1, Math.min(20, main.level));
  const res = createCharacter(
    { name, raceId, subraceId, classId, abilityScores: abilities, fightingStyleId: styleOptions.length ? styleOptions[0] : undefined },
    reg,
  );
  if (!res.character || res.errors.length) return { errors: [...errors, ...res.errors], warnings };
  let char = res.character;
  if (totalLevel > 1) {
    // ricostruisce il livello con scelte automatiche (stessa logica delle schede pregen)
    const subs = [...reg.subclasses.values()].filter((s) => s.classId === classId).sort((a, b) => a.id.localeCompare(b.id));
    const order = (Object.keys(char.abilityScores) as Ability[]).sort((a, b) => char.abilityScores[b] - char.abilityScores[a]);
    const primary = ((cls?.spellcasting?.ability as Ability | undefined) ?? order[0]);
    char = { ...char, houseRules: { ...char.houseRules, bypassXpCheck: true } };
    for (let newLevel = 2; newLevel <= totalLevel; newLevel++) {
      const effects = (cls?.features[newLevel] ?? []).flatMap((f) => f.effects);
      const asiPoints = effects.filter((e) => e.type === 'asi').reduce((a, e) => a + ((e as { points?: number }).points ?? 0), 0);
      let asi: Partial<Record<Ability, number>> | undefined;
      if (asiPoints > 0) {
        asi = {};
        let left = asiPoints;
        for (const ab of [primary, ...order.filter((a) => a !== primary)]) {
          if (left <= 0) break;
          const add = Math.min(2, left, 20 - char.abilityScores[ab]);
          if (add > 0) { asi[ab] = (asi[ab] ?? 0) + add; left -= add; }
        }
      }
      const subclassId = effects.some((e) => e.type === 'subclass') && subs.length ? subs[0].id : undefined;
      const r = applyLevelUp(char, reg, { classId, asi, subclassId });
      if (r.errors.length) { warnings.push(`Livello ${newLevel}: ${r.errors.join('; ')}`); break; }
      char = r.character;
    }
    char = { ...char, houseRules: { ...char.houseRules, bypassXpCheck: false } };
    warnings.push(`Livello ${totalLevel} ricostruito con PF medi e scelte automatiche (l'export D&D Beyond non include tiri, ASI e scelte)`);
  }
  return { character: char, errors, warnings };
}
