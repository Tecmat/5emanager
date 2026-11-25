import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Login con passkey via HTTP (pagina /login standalone, senza WS):
 *  - POST /api/passkey/options -> 200 { options } con challenge (pubblico, anche con REQUIRE_AUTH)
 *  - options con username senza passkey -> 400; username inesistente -> 400
 *  - POST /api/passkey/verify con challenge ignoto -> 400; passkey ignota -> 400
 *  - rate limit per IP su /api/passkey/options (DND5E_PASSKEY_MAX_ATTEMPTS) -> 429
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-pkhttp-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP</body></html>');
process.env.DND5E_STATIC_DIR = STATIC;
process.env.DND5E_REQUIRE_AUTH = 'true';
process.env.DND5E_ADMIN_TOKEN = 'adm-tok';
delete process.env.DND5E_REGISTRATION;

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
  delete process.env.DND5E_PASSKEY_MAX_ATTEMPTS;
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('POST /api/passkey/options (pubblico anche con REQUIRE_AUTH)', () => {
  it('senza username -> 200 con challenge (login discoverable)', async () => {
    const r = await post('/api/passkey/options', {});
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.options.challenge).toBeTruthy();
    expect(j.options.rpId).toBe('127.0.0.1');
  });

  it('username senza passkey -> 400; username inesistente -> 400', async () => {
    const r1 = await post('/api/passkey/options', { username: 'root' });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toMatch(/Nessuna passkey/);
    const r2 = await post('/api/passkey/options', { username: 'nonesiste' });
    expect(r2.status).toBe(400);
    expect((await r2.json()).error).toMatch(/Account non trovato/);
  });

  it('GET -> 405; rate limit per IP -> 429 dopo DND5E_PASSKEY_MAX_ATTEMPTS', async () => {
    const g = await fetch(base + '/api/passkey/options');
    expect(g.status).toBe(405);
    process.env.DND5E_PASSKEY_MAX_ATTEMPTS = '2';
    // i due tentativi sopra (root, nonesiste) contano già: la terza richiesta deve essere 429
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await post('/api/passkey/options', {})).status);
    expect(codes).toContain(429);
    delete process.env.DND5E_PASSKEY_MAX_ATTEMPTS;
  });
});

describe('POST /api/passkey/verify', () => {
  it('challenge sconosciuto -> 400', async () => {
    const r = await post('/api/passkey/verify', { response: { id: 'x', response: { challenge: 'inesistente' } } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/[Cc]hallenge/);
  });

  it('challenge valido ma passkey ignota -> 400 "non riconosciuta"', async () => {
    const o = await (await post('/api/passkey/options', {})).json();
    const r = await post('/api/passkey/verify', { response: { id: 'pk-sconosciuta', response: { challenge: o.options.challenge } } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/non riconosciuta/);
  });

  it('il challenge è monouso: riuso -> 400', async () => {
    const o = await (await post('/api/passkey/options', {})).json();
    const ch = o.options.challenge;
    const r1 = await post('/api/passkey/verify', { response: { id: 'pk-x', response: { challenge: ch } } });
    expect(r1.status).toBe(400); // passkey ignota, ma il challenge viene consumato
    const r2 = await post('/api/passkey/verify', { response: { id: 'pk-x', response: { challenge: ch } } });
    expect((await r2.json()).error).toMatch(/[Cc]hallenge/);
  });
});
