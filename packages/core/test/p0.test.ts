import { describe, expect, it } from 'vitest';
import {
  addCustomFeat,
  addCustomSpell,
  addItem,
  acBonusFromEffects,
  addSpellKnown,
  armorClass,
  attackBonus,
  castSpell,
  castSpellRitual,
  consumeMaterialComponent,
  createCharacter,
  damageBonusDice,
  exhaustionEffects,
  hasAdvantage,
  isMaterialConsumed,
  learnableSpells,
  materialText,
  maxHp,
  moveItemToContainer,
  parseEffect,
  prepareSpellForClass,
  preparedSpellsOfClass,
  rechargeItem,
  setCharges,
  setExhaustion,
  speedOf,
  totalWeight,
  unprepareSpellForClass,
  useCharge,
  type Character,

  maxSpellSlotLevel} from '../src/index.js';
import { createSrdRegistry } from '@dnd5e/data-srd';

const reg = createSrdRegistry();

function makeChar(classId = 'fighter'): Character {
  const res = createCharacter({
    name: 'Test', raceId: 'human', subraceId: 'human-standard', classId,
    abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
  }, reg);
  if (!res.character) throw new Error(res.errors.join(','));
  return res.character;
}

describe('P0: esaurimento 1-6', () => {
  it('effetti per livello e PF dimezzati a liv 4, velocità a liv 2/5, morte a liv 6', () => {
    let c = makeChar();
    const hpFull = maxHp(c, reg);
    c = setExhaustion(c, 1);
    expect(exhaustionEffects(c).disadvantageChecks).toBe(true);
    expect(exhaustionEffects(c).speedHalved).toBe(false);
    c = setExhaustion(c, 2);
    expect(exhaustionEffects(c).speedHalved).toBe(true);
    expect(speedOf(c, reg)).toBe(Math.floor((reg.races.get('human')?.speed ?? 30) / 2));
    c = setExhaustion(c, 3);
    expect(exhaustionEffects(c).disadvantageAttacksAndSaves).toBe(true);
    c = setExhaustion(c, 4);
    expect(exhaustionEffects(c).maxHpHalved).toBe(true);
    expect(maxHp(c, reg)).toBe(Math.floor(hpFull / 2));
    c = setExhaustion(c, 5);
    expect(speedOf(c, reg)).toBe(0);
    c = setExhaustion(c, 6);
    expect(exhaustionEffects(c).dead).toBe(true);
    expect(c.hp.current).toBe(0);
    // clamp
    c = setExhaustion(makeChar(), 99);
    expect(c.exhaustion).toBe(6);
  });
});

describe('P0: preparazione incantesimi per classe', () => {
  it('prepara/dispara per classe e mantiene la union in spellsPrepared', () => {
    let c = makeChar('cleric');
    let r = addSpellKnown(c, 'cure-wounds', reg);
    expect(r.error).toBeUndefined();
    c = r.character;
    const prep = prepareSpellForClass(c, 'cure-wounds', 'cleric', reg);
    expect(prep.error).toBeUndefined();
    c = prep.character;
    expect(preparedSpellsOfClass(c, 'cleric')).toContain('cure-wounds');
    expect(c.spellsPrepared).toContain('cure-wounds');
    // la classe guerriero non prepara
    const bad = prepareSpellForClass(c, 'cure-wounds', 'fighter', reg);
    expect(bad.error).toContain('non prepara');
    c = unprepareSpellForClass(c, 'cure-wounds', 'cleric');
    expect(preparedSpellsOfClass(c, 'cleric')).toEqual([]);
    expect(c.spellsPrepared).toEqual([]);
  });
});

describe('P0: rituale e componenti materiali', () => {
  it('cast rituale non consuma slot; cast normale sì; materiale consumato dall\'inventario', () => {
    let c = makeChar('wizard');
    c = { ...c, houseRules: { ...c.houseRules, bypassSpellLimit: true } }; // liv 1 = max 1 incantesimo conosciuto
    c = addSpellKnown(c, 'identify', reg).character; // rituale, M senza testo -> non consumato
    c = addSpellKnown(c, 'magic-missile', reg).character;
    const slotsBefore = JSON.stringify(c.spellSlots);
    const rit = castSpellRitual(c, 'identify', reg);
    expect(rit.error).toBeUndefined();
    expect(rit.ritual).toBe(true);
    expect(JSON.stringify(rit.character.spellSlots)).toBe(slotsBefore);
    // non rituale -> errore
    expect(castSpellRitual(c, 'magic-missile', reg).error).toContain('rituale');
    // cast normale consuma slot
    const usedBefore = c.spellSlots[1]?.used ?? 0;
    const cast = castSpell(c, 'magic-missile', 1, reg);
    expect(cast.error).toBeUndefined();
    expect(cast.character.spellSlots[1].used).toBe(usedBefore + 1);
  });

  it('componente materiale consumato: abbassa quantità oggetto corrispondente', () => {
    const spell = reg.spells.get('identify')!;
    expect(materialText(spell)).toBeNull(); // "V, S, M" senza parentesi
    const custom = addCustomSpell(reg, {
      id: 'test-gem', name: 'Test Gemma', level: 1, school: 'evocation', castingTime: '1 azione',
      range: '9 m', components: 'V, S, M (un diamante da 50 mo)', duration: 'Istantanea',
      description: 'Lancia un diamante.', source: 'custom',
    });
    expect(custom.ok).toBe(true);
    const sp = reg.spells.get('test-gem')!;
    expect(isMaterialConsumed(sp)).toBe(true);
    expect(materialText(sp)).toBe('un diamante da 50 mo');
    let c = makeChar();
    c = addItem(c, { name: 'Diamante', kind: 'treasure', quantity: 2, weight: 0, equipped: false, magic: false, attuned: false }).character;
    const r = consumeMaterialComponent(c, sp);
    expect(r.consumed).toBe('Diamante');
    expect(r.character.inventory[0].quantity).toBe(1);
  });
});

describe('P0: cariche e contenitori', () => {
  it('cariche: usa e ricarica; contenitori: peso ricorsivo e niente cicli', () => {
    let c = makeChar();
    c = addItem(c, { name: 'Bacchetta', kind: 'gear', quantity: 1, weight: 1, equipped: false, magic: true, attuned: false }).character;
    const wandId = c.inventory[0].id;
    let r = setCharges(c, wandId, 7);
    expect(r.error).toBeUndefined();
    c = r.character;
    expect(c.inventory[0].charges).toEqual({ current: 7, max: 7 });
    c = useCharge(c, wandId).character;
    c = useCharge(c, wandId).character;
    expect(c.inventory[0].charges!.current).toBe(5);
    expect(useCharge(c, 'inesistente').error).toBeTruthy();
    c = rechargeItem(c, wandId).character;
    expect(c.inventory[0].charges!.current).toBe(7);

    // contenitori: zaino (peso 5) con dentro 2 razioni (peso 1 cad) -> radice = 5 + 2 = 7
    c = addItem(c, { name: 'Zaino', kind: 'gear', quantity: 1, weight: 5, equipped: false, magic: false, attuned: false }).character;
    const backpackId = c.inventory.find((i) => i.name === 'Zaino')!.id;
    c = addItem(c, { name: 'Razione', kind: 'gear', quantity: 2, weight: 1, equipped: false, magic: false, attuned: false, containerId: backpackId }).character;
    // 1 (bacchetta) + 7 (zaino+contenuto) = 8
    expect(totalWeight(c)).toBe(1 + 7);
    // ciclo: zaino dentro la bacchetta? no; bacchetta dentro zaino ok; zaino dentro zaino vietato
    expect(moveItemToContainer(c, backpackId, backpackId).error).toContain('se stesso');
    const mv = moveItemToContainer(c, wandId, backpackId);
    expect(mv.error).toBeUndefined();
    expect(mv.character.inventory.find((i) => i.id === wandId)?.containerId).toBe(backpackId);
    expect(totalWeight(mv.character)).toBe(8); // zaino 5 + razioni 2 + bacchetta 1 (il peso non cambia, solo l'annidamento)
    // sposta di nuovo alla radice
    const back = moveItemToContainer(mv.character, wandId, null);
    expect(totalWeight(back.character)).toBe(8);
    expect(back.character.inventory.find((i) => i.id === wandId)?.containerId).toBeUndefined();
  });
});

describe('P0: mini-DSL effetti', () => {
  it('parseEffect reconoce le forme base', () => {
    expect(parseEffect('+2 CA')?.kind).toBe('ac');
    expect(parseEffect('+2 CA')?.value).toBe(2);
    expect(parseEffect('advantage: saves vs magic')?.kind).toBe('advantage');
    expect(parseEffect('advantage: saves vs magic')?.context).toBe('save');
    expect(parseEffect('advantage: saves vs magic')?.contextDetail).toBe('magic');
    expect(parseEffect('+1d6 fire damage')?.dice).toBe('1d6');
    expect(parseEffect('+1d6 fire damage')?.damageType).toBe('fire');
    expect(parseEffect('proficiency: skill stealth')?.profValue).toBe('stealth');
    expect(parseEffect('resistance: fire')?.kind).toBe('resistance');
    expect(parseEffect('speed +10')?.value).toBe(10);
    expect(parseEffect('testo a caso')?.kind).toBe('unknown');
  });

  it('gli effetti dei talenti custom si applicano: CA, danno extra, vantaggio', () => {
    const r = addCustomFeat(reg, {
      id: 'test-defense', name: 'Difesa TEST', description: 'test',
      effects: [
        { type: 'effect', text: '+2 CA' },
        { type: 'effect', text: '+1d6 fire damage' },
        { type: 'effect', text: 'advantage: saves vs magic' },
      ],
      source: 'custom',
    });
    expect(r.ok).toBe(true);
    let c = makeChar();
    const ac0 = armorClass(c, reg).ac;
    c = { ...c, feats: ['test-defense'] };
    expect(armorClass(c, reg).ac).toBe(ac0 + 2);
    expect(acBonusFromEffects(c, reg)).toBe(2);
    expect(damageBonusDice(c, reg)).toEqual([{ dice: '1d6', type: 'fire' }]);
    expect(hasAdvantage(c, reg, 'save', 'magic')).toBe(true);
    expect(hasAdvantage(c, reg, 'attack')).toBe(false);
  });
});

describe('fix dati: tutte le classi lancianti hanno incantesimi imparabili', () => {
  it('bard/sorcerer/druid/ranger possono imparare incantesimi entro il limite', () => {
    for (const classId of ['bard', 'sorcerer', 'druid', 'ranger', 'wizard', 'cleric']) {
      const c = makeChar(classId);
      const learnable = learnableSpells(c, reg);
      // gate RAW: mai incantesimi oltre il livello degli slot del PG (i trucchetti sono liv 0)
      expect(learnable.every((s) => s.level <= maxSpellSlotLevel(c))).toBe(true);
      if (classId !== 'ranger') expect(learnable.length).toBeGreaterThan(3); // il ranger lancia dal 2° livello
      const first = learnable.find((s) => s.level === 1) ?? learnable[0];
      if (!first) continue;
      const r = addSpellKnown(c, first.id, reg);
      expect(r.error).toBeUndefined();
      expect(r.character.spellsKnown).toContain(first.id);
    }
  });
});
