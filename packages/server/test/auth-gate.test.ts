import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const DATA = mkdtempSync(join(tmpdir(), 'dnd5e-auth-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP-5EMANAGER</body></html>');

process.env.DND5E_DATA_DIR = DATA;
process.env.DND5E_ADMIN_TOKEN = 'test-admin-token';
process.env.DND5E_REQUIRE_AUTH = 'true';
process.env.DND5E_STATIC_DIR = STATIC;
delete process.env.DND5E_REGISTRATION; // default: approval

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let port: number;
let base: string;

beforeAll(async () => {
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  port = server.port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

function connectWs(): Promise<{ ws: WebSocket; messages: any[]; send: (m: unknown) => void; waitFor: (pred: (m: any) => boolean, timeoutMs?: number) => Promise<any> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: any[] = [];
    const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      messages.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
    });
    ws.on('open', () => resolve({
      ws, messages,
      send: (m) => ws.send(JSON.stringify(m)),
      waitFor: (pred, timeoutMs = 4000) => new Promise((res, rej) => {
        const found = messages.find(pred);
        if (found) return res(found);
        const w = { pred, resolve: res };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout')); } }, timeoutMs);
      }),
    }));
  });
}

describe('DND5E_REQUIRE_AUTH: gate del sito + API login + registrazione + loginToken', () => {
  it('senza cookie il sito serve la pagina di login, non l\'app', async () => {
    const r = await fetch(base + '/');
    const body = await r.text();
    expect(body).toContain('5e Manager');
    expect(body).toContain('Login');
    expect(body).not.toContain('APP-5EMANAGER');
    // /api/info resta pubblico (scansione LAN) e dice requireAuth
    const info = await (await fetch(base + '/api/info')).json();
    expect(info.requireAuth).toBe(true);
    expect(info.registration).toBe('approval');
  });

  it('registrazione in modalita approval -> pending (niente cookie)', async () => {
    const r = await fetch(base + '/api/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'segreta1' }),
    });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.pending).toBe(true);
    expect(r.headers.get('set-cookie') ?? '').not.toContain('dnd5e_session=');
  });

  it('registrazione aperta (DND5E_REGISTRATION=open) -> account subito + cookie + app accessibile', async () => {
    process.env.DND5E_REGISTRATION = 'open';
    const r = await fetch(base + '/api/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'segreta2', remember: true }),
    });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.username).toBe('bob');
    expect(j.rememberToken).toBeTruthy();
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    expect(cookie.startsWith('dnd5e_session=')).toBe(true);
    // con il cookie il sito serve l'app
    const r2 = await fetch(base + '/', { headers: { cookie } });
    expect(await r2.text()).toContain('APP-5EMANAGER');
    // /api/me con cookie
    const me = await (await fetch(base + '/api/me', { headers: { cookie } })).json();
    expect(me.username).toBe('bob');
    // login-token con il remember token apre una nuova sessione
    const r3 = await fetch(base + '/api/login-token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: j.rememberToken }),
    });
    expect(r3.status).toBe(200);
    delete process.env.DND5E_REGISTRATION;
  });

  it('login HTTP: password sbagliata -> 400, giusta -> 200 + cookie', async () => {
    process.env.DND5E_REGISTRATION = 'open';
    await fetch(base + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'carol', password: 'pw-carol' }) });
    delete process.env.DND5E_REGISTRATION;
    const bad = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'carol', password: 'nope' }) });
    expect(bad.status).toBe(400);
    const ok = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'carol', password: 'pw-carol' }) });
    expect(ok.status).toBe(200);
    expect((ok.headers.get('set-cookie') ?? '')).toContain('dnd5e_session=');
  });

  it('WS: senza login create/join danno errore; dopo login funzionano; loginToken rientra senza password', async () => {
    // 1) senza sessione: create bloccato
    const c1 = await connectWs();
    c1.send({ t: 'create', name: 'X', password: 'pw', campaignName: 'Gated' });
    const err = await c1.waitFor((m) => m.t === 'error');
    expect(err.message).toMatch(/login richiesto/i);
    c1.ws.close();

    // 2) register aperta via WS + login con remember -> rememberToken
    process.env.DND5E_REGISTRATION = 'open';
    const c2 = await connectWs();
    c2.send({ t: 'register', username: 'dave', password: 'pw-dave' });
    await c2.waitFor((m) => m.t === 'auth');
    c2.ws.close();
    delete process.env.DND5E_REGISTRATION;

    const c3 = await connectWs();
    c3.send({ t: 'login', username: 'dave', password: 'pw-dave', remember: true });
    const auth = await c3.waitFor((m) => m.t === 'auth');
    expect(auth.rememberToken).toBeTruthy();
    // ora create funziona
    c3.send({ t: 'create', name: 'Dave', password: 'pw', campaignName: 'Gated2' });
    const w = await c3.waitFor((m) => m.t === 'welcome');
    expect(w.campaign.name).toBe('Gated2');
    c3.ws.close();

    // 3) nuova connessione: loginToken con il remember token -> auth senza password
    const c4 = await connectWs();
    c4.send({ t: 'loginToken', token: auth.rememberToken });
    const auth2 = await c4.waitFor((m) => m.t === 'auth');
    expect(auth2.username).toBe('dave');
    c4.ws.close();

    // 4) token falso -> errore
    const c5 = await connectWs();
    c5.send({ t: 'loginToken', token: 'falso' });
    const e5 = await c5.waitFor((m) => m.t === 'error');
    expect(e5.message).toMatch(/non valido/i);
    c5.ws.close();
  });
});
