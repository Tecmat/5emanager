import { describe, expect, it } from 'vitest';
import { applyCampaignAction, createRegistry, DEFAULT_HOUSE_RULES, migrateCampaign, resumeCampaign, type Campaign } from '../src/index.js';

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
  it('stesso id (una sola voce nella lista salvati), solo il master, niente schede/combattimento vecchi', () => {
    const master = { id: 'host-new', name: 'Master', role: 'master' as const };
    const c = resumeCampaign(savedCampaign(), 'segreto', master);
    expect(c.id).toBe('old-id');
    expect(c.passwordHash).toBe('segreto');
    expect(c.players).toEqual([master]);
    expect(c.characters).toEqual({});
    expect(c.combat).toBeNull();
  });
  it('password facoltativa: stringa vuota resta vuota (nessun controllo al join)', () => {
    const c = resumeCampaign(savedCampaign(), '', { id: 'm', name: 'M', role: 'master' });
    expect(c.passwordHash).toBe('');
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

describe('kickPlayer', () => {
  const reg = createRegistry();
  const camp = (): Campaign => ({
    id: 'c1',
    name: 'Test',
    passwordHash: 'x',
    houseRules: { ...DEFAULT_HOUSE_RULES },
    custom: {},
    players: [
      { id: 'm', name: 'Master', role: 'master' },
      { id: 'p1', name: 'Eroe', role: 'player' },
      { id: 'p2', name: 'Altro', role: 'player' },
    ],
    characters: { p1: { id: 'ch1' } as never, p2: { id: 'ch2' } as never },
    combat: null,
    groupInventory: [],
    groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('il master espelle un giocatore (rimosso da players e characters)', () => {
    const [next, err] = applyCampaignAction(camp(), 'm', reg, { kind: 'kickPlayer', playerId: 'p1' });
    expect(err).toBeUndefined();
    expect(next.players.map((p) => p.id)).toEqual(['m', 'p2']);
    expect(next.characters.p1).toBeUndefined();
    expect(next.characters.p2).toBeDefined();
  });
  it('un giocatore non può espellere; il master non può espellere sé stesso', () => {
    const [, err1] = applyCampaignAction(camp(), 'p1', reg, { kind: 'kickPlayer', playerId: 'p2' });
    expect(err1).toMatch(/Solo il master/);
    const [, err2] = applyCampaignAction(camp(), 'm', reg, { kind: 'kickPlayer', playerId: 'm' });
    expect(err2).toMatch(/te stesso/);
    const [, err3] = applyCampaignAction(camp(), 'm', reg, { kind: 'kickPlayer', playerId: ' inesistente' });
    expect(err3).toMatch(/non trovato/);
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
