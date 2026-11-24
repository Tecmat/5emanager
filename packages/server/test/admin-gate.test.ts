import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

/**
 * Gate della pagina /admin e dei messaggi admin (DND5E_REQUIRE_AUTH=true, come Docker):
 *  - /admin senza sessione -> 302 /login (mai la pagina a chi non e' loggato)
 *  - /admin con sessione non-admin -> 403
 *  - /admin con sessione admin -> 200
 *  - WS adminAuth: senza sessione bloccato; non-admin senza token -> errore; token admin valido -> ok; sessione admin -> ok
 *  - POST /api/update/apply con REQUIRE_AUTH: senza admin/token -> 403
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-admingate-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP-5EMANAGER</body></html>');
process.env.DND5E_STATIC_DIR = STATIC;
process.env.DND5E_REQUIRE_AUTH = 'true';
process.env.DND5E_ADMIN_TOKEN = 'adm-tok';
process.env.DND5E_GH_API = 'http://127.0.0.1:1'; // irraggiungibile: /api/update/apply -> 502 veloce, non 403
delete process.env.DND5E_REGISTRATION;

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let port: number;
let base: string;

beforeAll(async () => {
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  port = server.port;
  base = `http://127.0.0.1:${port}`;
  // primo admin via /api/setup (token) + un utente normale approvato
  const r = await fetch(base + '/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'adm-tok' },
    body: JSON.stringify({ username: 'root', password: 'root-pw-1' }),
  });
  expect(r.status).toBe(200);
  const accounts = await import('../src/accounts.js');
  accounts.requestAccount('user1', 'pw1234');
  accounts.approveAccount('user1');
});

afterAll(async () => {
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

async function loginCookie(username: string, password: string): Promise<string> {
  const r = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

function connectWs(cookie?: string): Promise<{ ws: WebSocket; msgs: any[]; send: (m: unknown) => void; waitFor: (pred: (m: any) => boolean, timeoutMs?: number) => Promise<any> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, cookie ? { headers: { cookie } } : undefined);
    const msgs: any[] = [];
    const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      msgs.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
    });
    ws.on('open', () => resolve({
      ws, msgs,
      send: (m) => ws.send(JSON.stringify(m)),
      waitFor: (pred, timeoutMs = 4000) => new Promise((res, rej) => {
        const found = msgs.find(pred);
        if (found) return res(found);
        const w = { pred, resolve: res };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout')); } }, timeoutMs);
      }),
    }));
  });
}

describe('pagina /admin con REQUIRE_AUTH (gate)', () => {
  it('senza cookie -> 302 /login (la pagina admin non si serve a chi non e\' loggato)', async () => {
    const r = await fetch(base + '/admin', { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/login');
  });

  it('con cookie admin -> 200 pagina admin', async () => {
    const cookie = await loginCookie('root', 'root-pw-1');
    const r = await fetch(base + '/admin', { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Admin server');
  });

  it('con cookie utente non-admin -> 403 (non vede neanche la pagina)', async () => {
    const cookie = await loginCookie('user1', 'pw1234');
    const r = await fetch(base + '/admin', { headers: { cookie } });
    expect(r.status).toBe(403);
    expect(await r.text()).toContain('riservata agli admin');
    // ma l'app resta accessibile
    const app = await fetch(base + '/', { headers: { cookie } });
    expect(await app.text()).toContain('APP-5EMANAGER');
  });
});

describe('WS adminAuth (REQUIRE_AUTH)', () => {
  it('senza sessione -> errore login richiesto', async () => {
    const c = await connectWs();
    c.send({ t: 'adminAuth', token: 'adm-tok' });
    const e = await c.waitFor((m) => m.t === 'error');
    expect(e.message).toMatch(/login richiesto/i);
    c.ws.close();
  });

  it('utente non-admin senza token -> errore; con token admin valido -> adminState', async () => {
    const cookie = await loginCookie('user1', 'pw1234');
    const c = await connectWs(cookie);
    c.send({ t: 'adminAuth', token: '' });
    const e = await c.waitFor((m) => m.t === 'error');
    expect(e.message).toMatch(/token admin non valido/i);
    c.send({ t: 'adminAuth', token: 'adm-tok' });
    const st = await c.waitFor((m) => m.t === 'adminState');
    expect(st.server.requireAuth).toBe(true);
    c.ws.close();
  });

  it('account admin -> adminAuth senza token ok (la sessione admin basta)', async () => {
    const cookie = await loginCookie('root', 'root-pw-1');
    const c = await connectWs(cookie);
    c.send({ t: 'adminAuth', token: '' });
    await c.waitFor((m) => m.t === 'adminState');
    c.send({ t: 'adminList' });
    await c.waitFor((m) => m.t === 'adminState');
    c.ws.close();
  });

  it('adminList senza adminAuth su sessione non-admin -> non autorizzato', async () => {
    const cookie = await loginCookie('user1', 'pw1234');
    const c = await connectWs(cookie);
    c.send({ t: 'adminList' });
    const e = await c.waitFor((m) => m.t === 'error');
    expect(e.message).toMatch(/non autorizzato/i);
    c.ws.close();
  });
});

describe('POST /api/update/apply con REQUIRE_AUTH', () => {
  it('senza sessione o con sessione non-admin -> 403; con token admin valido passa il gate', async () => {
    const noCookie = await fetch(base + '/api/update/apply', { method: 'POST' });
    expect(noCookie.status).toBe(403);
    const userCookie = await loginCookie('user1', 'pw1234');
    const user = await fetch(base + '/api/update/apply', { method: 'POST', headers: { cookie: userCookie } });
    expect(user.status).toBe(403);
    const withTok = await fetch(base + '/api/update/apply', { method: 'POST', headers: { cookie: userCookie, 'x-admin-token': 'adm-tok' } });
    expect(withTok.status).not.toBe(403); // passa il gate (poi fallisce sul mock GH -> 502)
    expect(withTok.status).toBe(502);
  });
});
