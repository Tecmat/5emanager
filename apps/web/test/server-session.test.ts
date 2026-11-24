// @vitest-environment jsdom
/**
 * Sessione lato server per la webapp servita DAL server (Docker):
 * checkServerSession() decide se l'utente e' gia' loggato (cookie -> /api/me),
 * se va redirectato a /login (401 + requireAuth) o se si salta (app nativa/dev/offline).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkServerSession, logoutServerSession } from '../src/serverSession.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('checkServerSession (webapp servita dal server: jsdom porta 3000)', () => {
  it('200 -> kind "server" con i dati di /api/me', async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ username: 'alice', role: 'admin', totpEnabled: false, requireAuth: true }) }));
    const s = await checkServerSession();
    expect(s.kind).toBe('server');
    if (s.kind === 'server') {
      expect(s.me.username).toBe('alice');
      expect(s.me.role).toBe('admin');
    }
  });

  it('401 + requireAuth -> kind "login" (il provider redirecta a /login)', async () => {
    stubFetch(async () => ({ ok: false, status: 401, json: async () => ({ requireAuth: true }) }));
    expect((await checkServerSession()).kind).toBe('login');
  });

  it('401 senza requireAuth -> skip (login facoltativo)', async () => {
    stubFetch(async () => ({ ok: false, status: 401, json: async () => ({ requireAuth: false }) }));
    expect((await checkServerSession()).kind).toBe('skip');
  });

  it('fetch che fallisce (offline, PWA dalla cache) -> skip: mai redirect', async () => {
    stubFetch(async () => { throw new Error('offline'); });
    expect((await checkServerSession()).kind).toBe('skip');
  });

  it('dev (porta 5173): skip senza nemmeno chiamare fetch', async () => {
    vi.stubGlobal('location', { ...window.location, host: 'localhost:5173', port: '5173', protocol: 'http:' });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await checkServerSession()).kind).toBe('skip');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('logoutServerSession (webapp servita dal server)', () => {
  it('revoca il cookie via /api/logout e, se il server impone il login, torna al /login', async () => {
    const calls: string[] = [];
    stubFetch(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/logout') return { ok: true, status: 200, json: async () => ({}) };
      return { ok: false, status: 401, json: async () => ({ requireAuth: true }) };
    });
    expect(await logoutServerSession()).toBe(true);
    expect(calls).toContain('/api/logout');
    expect(calls).toContain('/api/me');
  });

  it('se dopo il logout /api/me risponde ancora 200 non c\'è redirect', async () => {
    stubFetch(async (input: unknown) => {
      const url = String(input);
      if (url === '/api/logout') return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ username: 'alice', role: 'user', totpEnabled: false, requireAuth: true }) };
    });
    expect(await logoutServerSession()).toBe(false);
  });

  it('offline (fetch che fallisce) -> false, mai redirect e mai eccezione', async () => {
    stubFetch(async () => { throw new Error('offline'); });
    expect(await logoutServerSession()).toBe(false);
  });

  it('dev (porta 5173): false senza chiamare fetch', async () => {
    vi.stubGlobal('location', { ...window.location, host: 'localhost:5173', port: '5173', protocol: 'http:' });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await logoutServerSession()).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
