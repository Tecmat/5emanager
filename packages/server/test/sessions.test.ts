import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

/**
 * Gestione sessioni/dispositivi da admin:
 *  - login con remember -> dispositivo (remember token) elencato in adminAccountDetail
 *  - adminRevokeDevice revoca il singolo dispositivo (login-token poi 401)
 *  - adminRevokeAllDevices svuota i dispositivi
 *  - adminRevokeSessions invalida le sessioni in-memory (cookie /api/me -> 401)
 *  - tutto tracciato in audit.log
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-sessions-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP</body></html>');
process.env.DND5E_STATIC_DIR = STATIC;
process.env.DND5E_REQUIRE_AUTH = 'true';
process.env.DND5E_ADMIN_TOKEN = 'adm-tok';
delete process.env.DND5E_REGISTRATION;

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let auditMod: typeof import('../src/audit.js');
let accounts: typeof import('../src/accounts.js');
let port: number;
let base: string;

beforeAll(async () => {
  auditMod = await import('../src/audit.js');
  accounts = await import('../src/accounts.js');
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  port = server.port;
  base = `http://127.0.0.1:${port}`;
  const r = await fetch(base + '/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'adm-tok' },
    body: JSON.stringify({ username: 'root', password: 'root-pw-1' }),
  });
  expect(r.status).toBe(200);
  accounts.requestAccount('user1', 'pw1234');
  accounts.approveAccount('user1');
});

afterAll(async () => {
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function wsAdmin() {
  const login = await post('/api/login', { username: 'root', password: 'root-pw-1' });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  return new Promise<{ ws: WebSocket; send: (m: unknown) => void; waitFor: (pred: (m: any) => boolean, timeoutMs?: number) => Promise<any> }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { cookie } });
    const msgs: any[] = [];
    const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      msgs.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
    });
    ws.on('open', () => resolve({
      ws,
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

describe('sessioni e dispositivi (admin)', () => {
  it('login con remember -> dispositivo in adminAccountDetail (id, createdAt); login-token aggiorna lastUsedAt', async () => {
    const r = await post('/api/login', { username: 'user1', password: 'pw1234', remember: true });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.rememberToken).toBeTruthy();
    const admin = await wsAdmin();
    admin.send({ t: 'adminAccountDetail', username: 'user1' });
    const det = await admin.waitFor((m) => m.t === 'adminAccount');
    expect(det.devices.length).toBe(1);
    expect(det.devices[0].id).toHaveLength(10);
    expect(det.activeSessions).toBeGreaterThanOrEqual(1);
    // login-token con il remember token -> 200 e lastUsedAt aggiornato
    const lt = await post('/api/login-token', { token: j.rememberToken });
    expect(lt.status).toBe(200);
    const det2msgs = det;
    admin.send({ t: 'adminAccountDetail', username: 'user1' });
    const det2 = await admin.waitFor((m) => m.t === 'adminAccount' && m !== det2msgs);
    expect(det2.devices[0].lastUsedAt).toBeTruthy();
    admin.ws.close();
    (globalThis as any).__deviceId = det.devices[0].id;
    (globalThis as any).__rememberToken = j.rememberToken;
  });

  it('adminRevokeDevice: il dispositivo sparisce e il suo login-token -> 401', async () => {
    const admin = await wsAdmin();
    admin.send({ t: 'adminRevokeDevice', username: 'user1', tokenId: (globalThis as any).__deviceId });
    await admin.waitFor((m) => m.t === 'adminState');
    admin.send({ t: 'adminAccountDetail', username: 'user1' });
    const det = await admin.waitFor((m) => m.t === 'adminAccount' && m.devices.length === 0);
    expect(det.devices).toEqual([]);
    admin.ws.close();
    const lt = await post('/api/login-token', { token: (globalThis as any).__rememberToken });
    expect(lt.status).toBe(401);
  });

  it('adminRevokeAllDevices svuota i dispositivi; adminRevokeSessions uccide la sessione cookie (/api/me -> 401)', async () => {
    // nuovo dispositivo per user1
    const r = await post('/api/login', { username: 'user1', password: 'pw1234', remember: true });
    const j = await r.json();
    expect(j.rememberToken).toBeTruthy();
    const admin = await wsAdmin();
    admin.send({ t: 'adminRevokeAllDevices', username: 'user1' });
    await admin.waitFor((m) => m.t === 'adminState');
    const devices = accounts.listDevices('user1');
    expect(devices).toEqual([]);

    // sessione attiva di user1 (questa connexion del test) poi revoca sessioni
    const userLogin = await post('/api/login', { username: 'user1', password: 'pw1234' });
    const userCookie = (userLogin.headers.get('set-cookie') ?? '').split(';')[0];
    const me1 = await fetch(base + '/api/me', { headers: { cookie: userCookie } });
    expect(me1.status).toBe(200);
    admin.send({ t: 'adminRevokeSessions', username: 'user1' });
    await admin.waitFor((m) => m.t === 'adminState');
    const me2 = await fetch(base + '/api/me', { headers: { cookie: userCookie } });
    expect(me2.status).toBe(401);
    admin.ws.close();
  });

  it('le revoche sono in audit.log', async () => {
    const entries = auditMod.readAudit(50);
    expect(entries.some((e) => e.action === 'adminRevokeDevice' && e.detail?.includes('tokenId='))).toBe(true);
    expect(entries.some((e) => e.action === 'adminRevokeAllDevices' && e.detail?.includes('user1'))).toBe(true);
    expect(entries.some((e) => e.action === 'adminRevokeSessions' && e.detail?.includes('user1'))).toBe(true);
  });

  it('migrazione: rememberTokens string[] (v8) -> record (v9)', () => {
    const f = accounts.loadAccountsFile();
    f.accounts['user1'].rememberTokens = [{ hash: 'abc123', createdAt: '2026-01-01T00:00:00Z' }] as never;
    // simula vecchio formato stringa
    (f.accounts['user1'] as any).rememberTokens = ['deadbeef'];
    accounts.saveAccountsFile(f);
    const f2 = accounts.loadAccountsFile();
    expect(f2.v).toBe(9);
    expect(f2.accounts['user1'].rememberTokens?.[0]).toMatchObject({ hash: 'deadbeef' });
    expect(typeof f2.accounts['user1'].rememberTokens?.[0].createdAt).toBe('string');
  });
});
