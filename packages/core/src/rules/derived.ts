import type { Ability, ArmorDef, Character, ItemKind, WeaponDef } from '../types.js';
import type { Registry } from '../registry.js';
import { SKILLS } from '../types.js';

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function totalLevel(char: Character): number {
  return char.classLevels.reduce((sum, cl) => sum + cl.level, 0);
}

export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

export function modifierOf(char: Character, ability: Ability): number {
  return abilityModifier(char.abilityScores[ability]);
}

export function classSavingThrows(char: Character, reg: Registry): Set<Ability> {
  const saves = new Set<Ability>();
  for (const cl of char.classLevels) {
    const cls = reg.classes.get(cl.classId);
    if (cls) for (const s of cls.savingThrows) saves.add(s);
  }
  return saves;
}

export function savingThrowBonus(char: Character, ability: Ability, reg: Registry): number {
  let bonus = modifierOf(char, ability);
  if (classSavingThrows(char, reg).has(ability)) bonus += proficiencyBonus(totalLevel(char));
  return bonus;
}

export function skillBonus(char: Character, skillId: string): number {
  const skill = SKILLS.find((s) => s.id === skillId);
  if (!skill) return 0;
  let bonus = modifierOf(char, skill.ability);
  const pb = proficiencyBonus(totalLevel(char));
  if (char.proficiency.skills.includes(skillId)) bonus += pb;
  if (char.proficiency.expertise.includes(skillId)) bonus += pb;
  return bonus;
}

export function passivePerception(char: Character): number {
  return 10 + skillBonus(char, 'perception');
}

export function initiativeBonus(char: Character): number {
  return modifierOf(char, 'dex');
}

function equippedItem(char: Character, kind: ItemKind) {
  return char.inventory.find((i) => i.kind === kind && i.equipped);
}

export function armorClass(char: Character, reg: Registry): { ac: number; breakdown: string[] } {
  const breakdown: string[] = [];
  const armorItem = equippedItem(char, 'armor');
  const shieldItem = equippedItem(char, 'shield');
  const armor: ArmorDef | undefined = armorItem?.refId ? reg.armors.get(armorItem.refId) : undefined;
  const shield: ArmorDef | undefined = shieldItem?.refId ? reg.armors.get(shieldItem.refId) : undefined;
  const dexMod = modifierOf(char, 'dex');

  if (armor) {
    let ac = armor.ac + (armor.bonus ?? 0);
    breakdown.push(`${armor.name}: CA ${armor.ac}${armor.bonus ? ` +${armor.bonus} magico` : ''}`);
    if (armor.maxDex !== undefined && dexMod > armor.maxDex) {
      ac += armor.maxDex;
      breakdown.push(`bonus Des limitato a +${armor.maxDex} da ${armor.name}`);
    } else {
      ac += dexMod;
      if (dexMod !== 0) breakdown.push(`Des ${dexMod >= 0 ? '+' : ''}${dexMod}`);
    }
    if (shield) {
      const s = shield.ac + (shield.bonus ?? 0);
      ac += s;
      breakdown.push(`scudo: +${s}`);
    }
    return { ac, breakdown };
  }

  let ac = 10 + dexMod;
  breakdown.push(`10 base + Des ${dexMod >= 0 ? '+' : ''}${dexMod}`);
  if (shield) {
    const s = shield.ac + (shield.bonus ?? 0);
    ac += s;
    breakdown.push(`scudo: +${s}`);
  }
  for (const cl of char.classLevels) {
    const cls = reg.classes.get(cl.classId);
    if (!cls) continue;
    for (let lvl = 1; lvl <= cl.level; lvl++) {
      for (const f of cls.features[lvl] ?? []) {
        for (const e of f.effects) {
          if (e.type === 'unarmoredDefense') {
            const other = modifierOf(char, e.ability);
            ac += other;
            breakdown.push(`${f.name}: +${other} (${e.ability})`);
          }
        }
      }
    }
  }
  return { ac, breakdown };
}

export function weaponProficient(char: Character, weapon: WeaponDef): boolean {
  return (
    char.proficiency.weapons.includes(weapon.id) ||
    char.proficiency.weapons.includes(weapon.name) ||
    char.proficiency.weapons.includes(weapon.category)
  );
}

export function attackBonus(char: Character, weapon: WeaponDef): { bonus: number; ability: Ability; breakdown: string[] } {
  const breakdown: string[] = [];
  const str = modifierOf(char, 'str');
  const dex = modifierOf(char, 'dex');
  let ability: Ability;
  if (weapon.type === 'ranged') {
    ability = 'dex';
  } else if (weapon.properties.includes('finesse')) {
    ability = dex >= str ? 'dex' : 'str';
  } else {
    ability = 'str';
  }
  const mod = ability === 'str' ? str : dex;
  breakdown.push(`${ability.toUpperCase()} ${mod >= 0 ? '+' : ''}${mod}`);
  let bonus = mod;
  if (weaponProficient(char, weapon)) {
    const pb = proficiencyBonus(totalLevel(char));
    bonus += pb;
    breakdown.push(`proficienza +${pb}`);
  }
  if (weapon.bonus) {
    bonus += weapon.bonus;
    breakdown.push(`arma +${weapon.bonus}`);
  }
  return { bonus, ability, breakdown };
}

/** HP massimi: dado vita pieno al 1° livello di ogni classe, poi somma dei tiri + mod Cos per livello */
export function maxHp(char: Character, reg: Registry): number {
  const conMod = modifierOf(char, 'con');
  let hp = conMod * totalLevel(char);
  for (const cl of char.classLevels) {
    const cls = reg.classes.get(cl.classId);
    const die = cls?.hitDie ?? 8;
    for (let i = 0; i < cl.hitDiceRolled.length; i++) {
      hp += i === 0 ? die : cl.hitDiceRolled[i];
    }
  }
  return hp;
}

/** bonus attacco e CD dei tiri salvezza degli incantesimi (8 + proficiency + mod caratteristica) */
export function spellcastingInfo(char: Character, reg: Registry): { classId: string; ability: Ability; attackBonus: number; saveDC: number } | null {
  for (const cl of char.classLevels) {
    const sc = reg.classes.get(cl.classId)?.spellcasting;
    if (sc && cl.level > 0) {
      const mod = modifierOf(char, sc.ability);
      const pb = proficiencyBonus(totalLevel(char));
      return { classId: cl.classId, ability: sc.ability, attackBonus: 8 + pb + mod, saveDC: 8 + pb + mod };
    }
  }
  return null;
}

export function carryingCapacity(char: Character): { normal: number; encumbered: number; heavyLoad: number; pushDrag: number } {
  const str = char.abilityScores.str;
  return { normal: str * 15, encumbered: str * 5, heavyLoad: str * 10, pushDrag: str * 30 };
}
