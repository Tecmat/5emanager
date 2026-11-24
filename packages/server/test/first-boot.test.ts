import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

/**
 * Primo avvio + hardening per esposizione su HTTPS:
 *  - zero account -> GET / e /login redirectano a /setup (creazione primo admin)
 *  - una registrazione "pending" non deve occupare il setup (anti-squat su server pubblico fresco)
 *  - header di sicurezza; cookie Secure + HSTS solo con X-Forwarded-Proto: https
 *  - WS: Origin estraneo -> 403; cookie di sessione sull'upgrade -> 'auth' automatico
 *  - rate limit sui login falliti (HTTP)
 */
const DATA = mkdtempSync(join(tmpdir(), 'dnd5e-firstboot-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP-5EMANAGER</body></html>');

process.env.DND5E_DATA_DIR = DATA;
process.env.DND5E_STATIC_DIR = STATIC;
process.env.DND5E_REQUIRE_AUTH = 'true';
process.env.DND5E_ADMIN_TOKEN = 'boot-token';
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

const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('primo avvio (zero account)', () => {
  it('GET / e /login redirectano a /setup (302); /setup e /api/setup restano pubblici', async () => {
    const r = await fetch(base + '/', { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/setup');
    const r2 = await fetch(base + '/login', { redirect: 'manual' });
    expect(r2.status).toBe(302);
    expect(r2.headers.get('location')).toBe('/setup');
    expect((await fetch(base + '/setup')).status).toBe(200);
    expect((await fetch(base + '/api/setup')).status).toBe(200);
    const st = await (await fetch(base + '/api/setup')).json();
    expect(st.setupRequired).toBe(true);
  });

  it('una registrazione pending NON occupa il setup: /api/setup crea comunque il primo admin (anti-squat)', async () => {
    const reg = await postJson('/api/register', { username: 'squatter', password: 'pw1234' });
    expect(reg.status).toBe(200);
    expect((await reg.json()).pending).toBe(true);
    // resta setupRequired: le richieste pending non sono account
    const st = await (await fetch(base + '/api/setup')).json();
    expect(st.setupRequired).toBe(true);
    const r = await postJson('/api/setup', { username: 'owner', password: 'owner-pw-123' }, { 'x-admin-token': 'boot-token' });
    expect(r.status).toBe(200);
    expect((await r.json()).role).toBe('admin');
    // il secondo tentativo e' chiuso e / torna a servire la pagina di login (niente redirect)
    const r2 = await postJson('/api/setup', { username: 'altro', password: 'pw12345' }, { 'x-admin-token': 'boot-token' });
    expect(r2.status).toBe(403);
    const st2 = await (await fetch(base + '/api/setup')).json();
    expect(st2.setupRequired).toBe(false);
    const home = await fetch(base + '/', { redirect: 'manual' });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Login');
  });
});

describe('hardening HTTPS / origin WS / rate limit', () => {
  it('header di sicurezza su tutte le risposte; HSTS solo con X-Forwarded-Proto: https', async () => {
    const r = await fetch(base + '/api/info');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('strict-transport-security')).toBeNull();
    const r2 = await fetch(base + '/api/info', { headers: { 'x-forwarded-proto': 'https' } });
    expect(r2.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('cookie di sessione: Secure solo con X-Forwarded-Proto: https', async () => {
    const okPlain = await postJson('/api/login', { username: 'owner', password: 'owner-pw-123' });
    expect(okPlain.status).toBe(200);
    const c1 = okPlain.headers.get('set-cookie') ?? '';
    expect(c1).toContain('dnd5e_session=');
    expect(c1).toContain('HttpOnly');
    expect(c1).not.toContain('Secure');
    expect(okPlain.headers.get('strict-transport-security')).toBeNull();
    const okHttps = await postJson('/api/login', { username: 'owner', password: 'owner-pw-123' }, { 'x-forwarded-proto': 'https' });
    expect(okHttps.status).toBe(200);
    const c2 = okHttps.headers.get('set-cookie') ?? '';
    expect(c2).toContain('Secure');
    expect(okHttps.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('WS: Origin estraneo -> handshake 403; stesso origin o nessun Origin -> ok', async () => {
    await expect(
      new Promise((res, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://evil.example' });
        ws.on('open', () => { ws.close(); res('open'); });
        ws.on('error', rej);
      }),
    ).rejects.toThrow(/403/);
    await expect(
      new Promise((res, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `http://127.0.0.1:${port}` });
        ws.on('open', () => { ws.close(); res('open'); });
        ws.on('error', rej);
      }),
    ).resolves.toBe('open');
    await expect(
      new Promise((res, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`); // client non-browser: niente Origin
        ws.on('open', () => { ws.close(); res('open'); });
        ws.on('error', rej);
      }),
    ).resolves.toBe('open');
  });

  it('rate limit login HTTP: dopo N fallimenti -> 429', async () => {
    process.env.DND5E_LOGIN_MAX_ATTEMPTS = '3';
    try {
      for (let i = 0; i < 3; i++) {
        const r = await postJson('/api/login', { username: 'owner', password: 'sbagliata' });
        expect(r.status).toBe(400);
      }
      const r = await postJson('/api/login', { username: 'owner', password: 'sbagliata' });
      expect(r.status).toBe(429);
      expect((await r.json()).error).toMatch(/troppi tentativi/i);
    } finally {
      delete process.env.DND5E_LOGIN_MAX_ATTEMPTS;
    }
  });

  it('cookie di sessione sull\'upgrade WS -> il server manda subito auth (webapp gia loggata)', async () => {
    const login = await postJson('/api/login', { username: 'owner', password: 'owner-pw-123' });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { cookie } });
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 300));
    const auth = msgs.find((m) => m.t === 'auth');
    expect(auth).toBeTruthy();
    expect(auth.username).toBe('owner');
    expect(auth.role).toBe('admin');
    // login WS con solo username + sessione cookie valida -> rienvio auth, niente password
    ws.send(JSON.stringify({ t: 'login', username: 'owner' }));
    await new Promise((r) => setTimeout(r, 300));
    const auths = msgs.filter((m) => m.t === 'auth');
    expect(auths.length).toBe(2);
    expect(auths[1].username).toBe('owner');
    ws.close();
  });
});
