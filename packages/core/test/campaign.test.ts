import { describe, expect, it } from 'vitest';
import { DEFAULT_HOUSE_RULES, migrateCampaign, resumeCampaign, type Campaign } from '../src/index.js';

function savedCampaign(): Campaign {
  return {
    id: 'old-id',
    name: 'Sessione 1',
    passwordHash: '', // mai salvata su disco
    houseRules: { ...DEFAULT_HOUSE_RULES },
    custom: {},
    players: [
      { id: 'host-x', name: 'Master', role: 'master' },
      { id: 'p1', name: 'Eroe', role: 'player' },
    ],
    characters: { p1: {} as never },
    combat: { turnIndex: 3 } as never,
    groupInventory: [{ id: 'i1', name: 'Pozione', quantity: 2 } as never],
    groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
    notes: 'note di sessione',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('resumeCampaign (P2P host riprende da snapshot locale)', () => {
  it('nuovo id, solo il master, niente schede/combattimento vecchi, password reinserita', () => {
    const master = { id: 'host-new', name: 'Master', role: 'master' as const };
    const c = resumeCampaign(savedCampaign(), 'segreto', master);
    expect(c.id).not.toBe('old-id');
    expect(c.id).toMatch(/^[a-z0-9]+$/);
    expect(c.passwordHash).toBe('segreto');
    expect(c.players).toEqual([master]);
    expect(c.characters).toEqual({});
    expect(c.combat).toBeNull();
  });
  it('conserva nome, note, tesoro/inventario di gruppo e createdAt', () => {
    const c = resumeCampaign(savedCampaign(), 'pw', { id: 'm', name: 'M', role: 'master' });
    expect(c.name).toBe('Sessione 1');
    expect(c.notes).toBe('note di sessione');
    expect(c.groupCurrency.gp).toBe(10);
    expect(c.groupInventory).toHaveLength(1);
    expect(c.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(c.updatedAt).not.toBe('2026-01-02T00:00:00.000Z');
  });
  it('riempie i campi mancanti delle vecchie versioni (migrate)', () => {
    const old = { id: 'x', name: 'n', passwordHash: '' } as unknown as Campaign;
    const c = resumeCampaign(old, 'pw', { id: 'm', name: 'M', role: 'master' });
    expect(c.groupInventory).toEqual([]);
    expect(c.notes).toBe('');
    expect(c.groupCurrency).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  });
});

describe('migrateCampaign', () => {
  it('aggiunge groupInventory/groupCurrency/notes se mancano', () => {
    const old = { id: 'x', name: 'n', passwordHash: 'h' } as unknown as Campaign;
    const c = migrateCampaign(old);
    expect(c.groupInventory).toEqual([]);
    expect(c.groupCurrency.gp).toBe(0);
    expect(c.notes).toBe('');
    expect(c.passwordHash).toBe('h');
  });
});
