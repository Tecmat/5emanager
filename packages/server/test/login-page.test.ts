import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Pagina /login con DND5E_REQUIRE_AUTH=true (come Docker):
 *  - senza sessione -> 200 con la pagina di login standalone TEMATA (mai l'SPA: niente loop con /api/me)
 *  - con sessione valida -> 302 all'app '/'
 *  - path non pubblico (es. /) senza sessione -> stessa pagina di login
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-loginpage-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP-5EMANAGER</body></html>');
process.env.DND5E_STATIC_DIR = STATIC;
process.env.DND5E_REQUIRE_AUTH = 'true';
process.env.DND5E_ADMIN_TOKEN = 'adm-tok';

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let base: string;

beforeAll(async () => {
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.port}`;
  const r = await fetch(base + '/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'adm-tok' },
    body: JSON.stringify({ username: 'root', password: 'root-pw-1' }),
  });
  expect(r.status).toBe(200);
});

afterAll(async () => {
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

describe('pagina /login con REQUIRE_AUTH', () => {
  it('senza cookie serve la pagina di login standalone temata, non l\'SPA', async () => {
    const r = await fetch(base + '/login', { redirect: 'manual' });
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('<title>5e Manager — Login</title>');
    expect(body).toContain('--accent:#c9a227'); // tema D&D condiviso con l'app
    expect(body).not.toContain('APP-5EMANAGER'); // non è il fallback SPA
  });

  it('/login.html idem', async () => {
    const r = await fetch(base + '/login.html', { redirect: 'manual' });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>5e Manager — Login</title>');
  });

  it('con sessione valida -> 302 all\'app (niente form di login a chi è già loggato)', async () => {
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'root-pw-1' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const r = await fetch(base + '/login', { redirect: 'manual', headers: { cookie } });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
  });

  it('path non pubblico (/) senza cookie -> pagina di login, non l\'SPA', async () => {
    const r = await fetch(base + '/', { redirect: 'manual' });
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('<title>5e Manager — Login</title>');
    expect(body).not.toContain('APP-5EMANAGER');
  });

  it('con sessione valida / serve l\'app', async () => {
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'root-pw-1' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const r = await fetch(base + '/', { redirect: 'manual', headers: { cookie } });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('APP-5EMANAGER');
  });

  it('l\'HTML della webapp servita contiene il marker <meta name="dnd5e-server"> (niente euristiche sull\'origin)', async () => {
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'root-pw-1' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    // sia la root sia il fallback SPA ricevono il marker
    for (const p of ['/', '/qualunque-cosa']) {
      const r = await fetch(base + p, { redirect: 'manual', headers: { cookie } });
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('name="dnd5e-server"');
    }
    // le pagine standalone (login) NON lo hanno
    const rl = await fetch(base + '/login', { redirect: 'manual' });
    expect(await rl.text()).not.toContain('name="dnd5e-server"');
  });
});
