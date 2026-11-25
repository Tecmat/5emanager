// @vitest-environment jsdom
/**
 * Editor regole base (SRD): override persistenti (localStorage/IDB) applicati sopra
 * SRD_DATA nel registry (loadData sovrascrive per id), con export/import JSON e validazione.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createRegistry, loadData } from '@dnd5e/core';
import { SRD_DATA, createSrdRegistry } from '@dnd5e/data-srd';
import {
  SRD_OVERRIDES_KEY,
  applyOverridesToRegistry,
  countOverrides,
  exportOverrides,
  importOverrides,
  loadOverrides,
  materializeOverrides,
  removeOverride,
  saveOverrides,
  upsertOverride,
  validateOverrideEntry,
  type SrdOverrides,
} from '../src/srdOverrides.js';

beforeEach(() => {
  localStorage.clear();
});

describe('srdOverrides', () => {
  it('upsert/remove/count per categoria e id', () => {
    let o: SrdOverrides = {};
    o = upsertOverride(o, 'spells', { id: 'fire-bolt', name: 'Dardo Infuocato (rivisto)' });
    o = upsertOverride(o, 'spells', { id: 'magic-missile', name: 'Dardo Magico' });
    o = upsertOverride(o, 'weapons', { id: 'longsword', name: 'Spada Lunga' });
    expect(countOverrides(o)).toBe(3);
    o = upsertOverride(o, 'spells', { id: 'fire-bolt', name: 'Dardo Infuocato v2' });
    expect(countOverrides(o)).toBe(3);
    expect(o.spells?.['fire-bolt'].name).toBe('Dardo Infuocato v2');
    o = removeOverride(o, 'spells', 'fire-bolt');
    expect(countOverrides(o)).toBe(2);
    expect(o.spells?.['fire-bolt']).toBeUndefined();
    expect(() => upsertOverride(o, 'spells', { name: 'senza id' })).toThrow();
  });

  it('applyOverridesToRegistry: sovrascrive per id sopra l\'SRD, il resto resta intatto', () => {
    const reg = createSrdRegistry();
    const before = reg.spells.get('fire-bolt')?.name;
    expect(before).toBeTruthy();
    const o = upsertOverride({}, 'spells', { id: 'fire-bolt', name: 'Dardo Infuocato (rivisto)', level: 0 });
    applyOverridesToRegistry(reg, o);
    expect(reg.spells.get('fire-bolt')?.name).toBe('Dardo Infuocato (rivisto)');
    expect(reg.spells.size).toBe(SRD_DATA.spells.length); // nessun duplicato
    expect(reg.weapons.size).toBe(SRD_DATA.weapons.length);
  });

  it('materialize produce un SrdData completo (array vuoti dove non ci sono override)', () => {
    const m = materializeOverrides(upsertOverride({}, 'enemies', { id: 'goblin', name: 'Goblin' }));
    expect(m.enemies).toHaveLength(1);
    expect(m.spells).toHaveLength(0);
    expect(m.classes).toHaveLength(0);
    const reg = createRegistry();
    loadData(reg, SRD_DATA);
    loadData(reg, m); // non deve crashare
  });

  it('validateOverrideEntry: id mancante -> errore; entry valida -> null', () => {
    expect(validateOverrideEntry('spells', { name: 'x' })).toMatch(/id/);
    expect(validateOverrideEntry('spells', { id: 'fire-bolt', name: 'ok' })).toBeNull();
  });

  it('persistenza: save/load roundtrip e export/import roundtrip', async () => {
    let o: SrdOverrides = {};
    o = upsertOverride(o, 'spells', { id: 'fire-bolt', name: 'X' });
    await saveOverrides(o);
    const loaded = await loadOverrides();
    expect(loaded.spells?.['fire-bolt'].name).toBe('X');
    expect(localStorage.getItem(SRD_OVERRIDES_KEY)).toBeTruthy();

    const json = exportOverrides(loaded);
    const r = importOverrides(json);
    expect(r.error).toBeNull();
    expect(r.count).toBe(1);
    expect(r.data?.spells?.['fire-bolt'].name).toBe('X');
    // formato semplice {spells: [...]} accettato
    const r2 = importOverrides(JSON.stringify({ spells: [{ id: 'mage-armor', name: 'Armatura del Mago' }] }));
    expect(r2.error).toBeNull();
    expect(r2.count).toBe(1);
    // json invalido -> errore
    expect(importOverrides('{non json').error).toBeTruthy();
  });
});
