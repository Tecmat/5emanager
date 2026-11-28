import { describe, expect, it } from 'vitest';
import {
  validateArmorDef,
  validateBackgroundDef,
  validateClassDef,
  validateEnemyDef,
  validateFeatDef,
  validateRaceDef,
  validateSpellDef,
  validateSubclassDef,
  validateWeaponDef,
} from '@dnd5e/core';
import { SRD_DATA } from '../src/index.js';

/**
 * Audit di completezza/validità dei dati SRD (gate per le release):
 * - ogni definizione passa la validazione del core
 * - 12 classi PHB,ognuna con dado vita valido, feature al liv 1 e un archetipo entro il liv 3
 * - almeno 3 archetipi per classe e riferimenti coerenti (classId -> classe esistente)
 * - incantesimi con classi valide, razze con velocità, nemici con PF/CA/attacchi
 */

const PHB_CLASSES = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];

describe('audit dati SRD', () => {
  it('ogni definizione passa la validazione del core', () => {
    const errors: string[] = [];
    for (const c of SRD_DATA.classes) errors.push(...validateClassDef(c).map((e) => `class ${c.id}: ${e}`));
    const classIds = new Set(SRD_DATA.classes.map((c) => c.id));
    for (const s of SRD_DATA.subclasses) errors.push(...validateSubclassDef(s, classIds).map((e) => `subclass ${s.id}: ${e}`));
    for (const r of SRD_DATA.races) errors.push(...validateRaceDef(r).map((e) => `race ${r.id}: ${e}`));
    for (const s of SRD_DATA.spells) errors.push(...validateSpellDef(s).map((e) => `spell ${s.id}: ${e}`));
    for (const w of SRD_DATA.weapons) errors.push(...validateWeaponDef(w).map((e) => `weapon ${w.id}: ${e}`));
    for (const a of SRD_DATA.armors) errors.push(...validateArmorDef(a).map((e) => `armor ${a.id}: ${e}`));
    for (const f of SRD_DATA.feats) errors.push(...validateFeatDef(f).map((e) => `feat ${f.id}: ${e}`));
    for (const e of SRD_DATA.enemies) errors.push(...validateEnemyDef(e).map((e2) => `enemy ${e.id}: ${e2}`));
    for (const b of SRD_DATA.backgrounds ?? []) errors.push(...validateBackgroundDef(b).map((e) => `background ${b.id}: ${e}`));
    expect(errors).toEqual([]);
  });

  it('ci sono esattamente le 12 classi PHB', () => {
    expect(SRD_DATA.classes.map((c) => c.id).sort()).toEqual([...PHB_CLASSES].sort());
  });

  it('ogni classe ha dado vita valido, feature al liv 1 e archetipo entro il liv 3', () => {
    for (const c of SRD_DATA.classes) {
      expect([6, 8, 10, 12]).toContain(c.hitDie);
      expect(c.features[1]?.length, `classe ${c.id} senza feature liv 1`).toBeGreaterThan(0);
      const subLevel = Object.keys(c.features)
        .map(Number)
        .filter((l) => (c.features[l] ?? []).some((f) => f.effects.some((e) => e.type === 'subclass')))
        .sort((a, b) => a - b)[0];
      expect(subLevel, `classe ${c.id} senza archetipo entro liv 3`).toBeLessThanOrEqual(3);
    }
  });

  it('almeno 3 archetipi per ogni classe, tutti riferiti a classi esistenti', () => {
    const classIds = new Set(SRD_DATA.classes.map((c) => c.id));
    const byClass = new Map<string, number>();
    for (const s of SRD_DATA.subclasses) {
      expect(classIds.has(s.classId), `archetipo ${s.id} -> classe inesistente ${s.classId}`).toBe(true);
      byClass.set(s.classId, (byClass.get(s.classId) ?? 0) + 1);
    }
    for (const c of SRD_DATA.classes) {
      expect(byClass.get(c.id) ?? 0, `classe ${c.id} con meno di 3 archetipi`).toBeGreaterThanOrEqual(3);
    }
  });

  it('gli incantesimi referenziano solo classi esistenti e hanno i campi base', () => {
    const classIds = new Set(SRD_DATA.classes.map((c) => c.id));
    expect(SRD_DATA.spells.length).toBeGreaterThanOrEqual(100);
    for (const s of SRD_DATA.spells) {
      expect(s.school).toBeTruthy();
      for (const cl of s.classes ?? []) expect(classIds.has(cl), `incantesimo ${s.id} -> classe inesistente ${cl}`).toBe(true);
      if (s.level > 0) expect(s.damage ?? s.description, `incantesimo ${s.id} di liv ${s.level} senza danno né descrizione`).toBeTruthy();
    }
  });

  it('razze e nemici hanno i campi essenziali', () => {
    expect(SRD_DATA.races.length).toBeGreaterThanOrEqual(9);
    for (const r of SRD_DATA.races) {
      expect(r.speed, `razza ${r.id} senza velocità`).toBeGreaterThan(0);
      expect(r.traits.length, `razza ${r.id} senza tratti`).toBeGreaterThan(0);
    }
    for (const e of SRD_DATA.enemies) {
      expect(e.hp, `nemico ${e.id} senza PF`).toBeGreaterThan(0);
      expect(e.ac, `nemico ${e.id} senza CA`).toBeGreaterThan(0);
      expect(e.attacks.length, `nemico ${e.id} senza attacchi`).toBeGreaterThan(0);
    }
  });

  it('ci sono background SRD validi', () => {
    expect((SRD_DATA.backgrounds ?? []).length).toBeGreaterThanOrEqual(10);
  });
});
