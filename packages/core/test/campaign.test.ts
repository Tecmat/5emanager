import { describe, expect, it } from 'vitest';
import { applyCampaignAction, createRegistry, DEFAULT_HOUSE_RULES, DEFAULT_STATS, migrateCampaign, resumeCampaign, setPlayerOnline, type Campaign } from '../src/index.js';

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
    chat: [],
    stats: { ...DEFAULT_STATS },
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
    chat: [],
    stats: { ...DEFAULT_STATS },
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

describe('chat di campagna', () => {
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
    ],
    characters: {},
    combat: null,
    groupInventory: [],
    groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: '',
    chat: [],
    stats: { ...DEFAULT_STATS },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('aggiunge messaggi con autore e timestamp,拒绝 vuoti e sanifica', () => {
    let c = camp();
    [c] = applyCampaignAction(c, 'p1', reg, { kind: 'chat', text: '  ciao a tutti!  ' });
    expect(c.chat).toHaveLength(1);
    expect(c.chat[0]).toMatchObject({ fromId: 'p1', from: 'Eroe', text: 'ciao a tutti!' });
    expect(typeof c.chat[0].at).toBe('string');

    const [c2, err] = applyCampaignAction(c, 'p1', reg, { kind: 'chat', text: '   ' });
    expect(err).toMatch(/vuoto/);
    expect(c2.chat).toHaveLength(1);

    const long = 'x'.repeat(600);
    const [c3] = applyCampaignAction(c, 'p1', reg, { kind: 'chat', text: long });
    expect(c3.chat[1].text).toHaveLength(500);
  });

  it('tiene solo gli ultimi 200 messaggi', () => {
    let c = camp();
    for (let i = 0; i < 205; i++) {
      [c] = applyCampaignAction(c, 'p1', reg, { kind: 'chat', text: 'm' + i });
    }
    expect(c.chat).toHaveLength(200);
    expect(c.chat[0].text).toBe('m5');
    expect(c.chat[199].text).toBe('m204');
  });

  it('migrateCampaign riempie chat mancante', () => {
    const old = camp() as Partial<Campaign>;
    delete old.chat;
    const m = migrateCampaign(old as Campaign);
    expect(m.chat).toEqual([]);
  });

  it('setPlayerOnline marca online/offline solo il giocatore giusto', () => {
    const c = camp();
    expect(c.players.length).toBeGreaterThanOrEqual(1);
    const pid = c.players[0].id;
    setPlayerOnline(c, pid, false);
    expect(c.players.find((p) => p.id === pid)?.online).toBe(false);
    setPlayerOnline(c, pid, true);
    expect(c.players.find((p) => p.id === pid)?.online).toBe(true);
    // id inesistente: no-op
    setPlayerOnline(c, 'inesistente', false);
    expect(c.players.some((p) => p.online === false)).toBe(false);
  });
});

describe('mappa tattica (moveToken / setMapSize)', () => {
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
    combat: {
      combatants: [
        { id: 'ch1', name: 'Eroe', isPlayer: true, hp: 10, maxHp: 10 } as never,
        { id: 'e1', name: 'Goblin', isPlayer: false, hp: 7, maxHp: 7 } as never,
      ],
      round: 1,
      turnIndex: 0, // turno di ch1 (PG di p1)
      log: [],
    },
    groupInventory: [],
    groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: '',
    chat: [],
    stats: { ...DEFAULT_STATS },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('la mappa viene creata on-demand e il token si sposta con clamp ai bordi', () => {
    const [c1] = applyCampaignAction(camp(), 'm', reg, { kind: 'moveToken', targetId: 'e1', x: 3, y: 4 });
    expect(c1.combat!.map).toBeDefined();
    expect(c1.combat!.map!.tokens['e1']).toEqual({ x: 3, y: 4 });
    const [c2] = applyCampaignAction(camp(), 'm', reg, { kind: 'moveToken', targetId: 'e1', x: 999, y: -5 });
    expect(c2.combat!.map!.tokens['e1']).toEqual({ x: c2.combat!.map!.cols - 1, y: 0 });
  });

  it('permessi: master muove tutto; PG solo il proprio token e solo nel suo turno', () => {
    // p1 e' di turno (turnIndex 0 = ch1): puo' muovere ch1 ma non e1
    const [ok1, err1] = applyCampaignAction(camp(), 'p1', reg, { kind: 'moveToken', targetId: 'ch1', x: 5, y: 5 });
    expect(err1).toBeUndefined();
    expect(ok1.combat!.map!.tokens['ch1']).toEqual({ x: 5, y: 5 });
    const [, err2] = applyCampaignAction(camp(), 'p1', reg, { kind: 'moveToken', targetId: 'e1', x: 5, y: 5 });
    expect(err2).toMatch(/solo il tuo token/);
    // p2 non e' di turno: niente
    const [, err3] = applyCampaignAction(camp(), 'p2', reg, { kind: 'moveToken', targetId: 'ch2', x: 1, y: 1 });
    expect(err3).toMatch(/solo il tuo token/);
    // master: tutto ok
    const [ok4, err4] = applyCampaignAction(camp(), 'm', reg, { kind: 'moveToken', targetId: 'e1', x: 2, y: 2 });
    expect(err4).toBeUndefined();
    expect(ok4.combat!.map!.tokens['e1']).toEqual({ x: 2, y: 2 });
  });

  it('setMapSize: solo master, con clamp dei token dentro la nuova griglia', () => {
    const [, err] = applyCampaignAction(camp(), 'p1', reg, { kind: 'setMapSize', cols: 8, rows: 6 });
    expect(err).toMatch(/solo il master/i);
    let c = camp();
    [c] = applyCampaignAction(c, 'm', reg, { kind: 'moveToken', targetId: 'e1', x: 15, y: 11 });
    [c] = applyCampaignAction(c, 'm', reg, { kind: 'setMapSize', cols: 8, rows: 6 });
    expect(c.combat!.map!.cols).toBe(8);
    expect(c.combat!.map!.tokens['e1']).toEqual({ x: 7, y: 5 });
  });

  it('senza combattimento niente mappa', () => {
    const c = camp();
    c.combat = null;
    const [, err] = applyCampaignAction(c, 'm', reg, { kind: 'moveToken', targetId: 'e1', x: 1, y: 1 });
    expect(err).toMatch(/Nessun combattimento/);
  });
});
