import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

/**
 * Gate /admin in modalita' LAN (REQUIRE_AUTH off, nessun DND5E_ADMIN_TOKEN):
 *  - server fresco (zero account): /admin aperta (flusso /setup)
 *  - con account esistenti: senza sessione -> 403; sessione admin -> 200; sessione user -> 403
 *  - WS adminAuth: senza sessione e con account esistenti -> errore; sessione admin -> ok
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-adminlan-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP-5EMANAGER</body></html>');
process.env.DND5E_STATIC_DIR = STATIC;
delete process.env.DND5E_REQUIRE_AUTH;
delete process.env.DND5E_ADMIN_TOKEN;

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

async function loginCookie(username: string, password: string): Promise<string> {
  const r = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

function connectWs(cookie?: string): Promise<{ ws: WebSocket; send: (m: unknown) => void; waitFor: (pred: (m: any) => boolean, timeoutMs?: number) => Promise<any> }> {
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

describe('pagina /admin in LAN (senza REQUIRE_AUTH, senza token)', () => {
  it('server fresco (zero account) -> 200', async () => {
    const r = await fetch(base + '/admin');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Admin server');
  });

  it('dopo aver creato degli account: senza sessione -> 403, con ?token= -> comunque 403 (nessun token configurato)', async () => {
    const accounts = await import('../src/accounts.js');
    accounts.createFirstAdmin('root', 'root-pw-1');
    accounts.requestAccount('user1', 'pw1234');
    accounts.approveAccount('user1');
    const r1 = await fetch(base + '/admin');
    expect(r1.status).toBe(403);
    const r2 = await fetch(base + '/admin?token=qualcosa');
    expect(r2.status).toBe(403);
  });

  it('sessione admin -> 200; sessione user -> 403', async () => {
    const adminCookie = await loginCookie('root', 'root-pw-1');
    expect((await fetch(base + '/admin', { headers: { cookie: adminCookie } })).status).toBe(200);
    const userCookie = await loginCookie('user1', 'pw1234');
    expect((await fetch(base + '/admin', { headers: { cookie: userCookie } })).status).toBe(403);
  });

  it('WS adminAuth: senza sessione (account esistenti) -> errore; sessione admin -> adminState', async () => {
    const c1 = await connectWs();
    c1.send({ t: 'adminAuth', token: '' });
    const e = await c1.waitFor((m) => m.t === 'error');
    expect(e.message).toMatch(/token admin non valido/i);
    c1.ws.close();
    const adminCookie = await loginCookie('root', 'root-pw-1');
    const c2 = await connectWs(adminCookie);
    c2.send({ t: 'adminAuth', token: '' });
    await c2.waitFor((m) => m.t === 'adminState');
    c2.ws.close();
  });
});
