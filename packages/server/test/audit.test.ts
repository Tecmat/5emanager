import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

/**
 * Audit log del server (audit.log JSONL in DND5E_DATA_DIR, ruotato a .1 oltre DND5E_AUDIT_MAX_BYTES):
 *  - first-admin, login/login-failed (HTTP e WS), invite-create/invite-used/invite-failed,
 *    azioni admin (adminBroadcast, adminSetRole, adminCreateInvite...) con actor+detail
 *  - adminAudit (WS, solo admin) -> auditLog con gli ultimi N eventi, piu' recente prima
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-audit-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP</body></html>');
process.env.DND5E_STATIC_DIR = STATIC;
process.env.DND5E_REQUIRE_AUTH = 'true';
process.env.DND5E_ADMIN_TOKEN = 'adm-tok';
delete process.env.DND5E_AUDIT_MAX_BYTES; // default 5 MB: la rotazione si testa a runtime nel test dedicado
delete process.env.DND5E_REGISTRATION;

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let auditMod: typeof import('../src/audit.js');
let port: number;
let base: string;

beforeAll(async () => {
  auditMod = await import('../src/audit.js');
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
  const accounts = await import('../src/accounts.js');
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

async function wsWithCookie(username: string, password: string) {
  const login = await post('/api/login', { username, password });
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

describe('audit log', () => {
  it('first-admin e login HTTP (ok + fallito) finiscono nel log', async () => {
    await post('/api/login', { username: 'root', password: 'root-pw-1' });
    await post('/api/login', { username: 'root', password: 'sbagliata' });
    const entries = auditMod.readAudit(50);
    expect(entries.some((e) => e.action === 'first-admin' && e.actor === 'setup' && e.detail === 'root')).toBe(true);
    expect(entries.some((e) => e.action === 'login' && e.actor === 'root')).toBe(true);
    expect(entries.some((e) => e.action === 'login-failed' && e.actor === 'root')).toBe(true);
    // mai password nel log
    expect(JSON.stringify(entries)).not.toContain('root-pw-1');
    expect(JSON.stringify(entries)).not.toContain('sbagliata');
  });

  it('azioni admin auditate e adminAudit (solo admin) ritorna gli ultimi eventi, piu\' recente prima', async () => {
    const admin = await wsWithCookie('root', 'root-pw-1');
    admin.send({ t: 'adminBroadcast', message: 'manutenzione' });
    await admin.waitFor((m) => m.t === 'adminState');
    admin.send({ t: 'adminSetRole', username: 'user1', role: 'admin' });
    await admin.waitFor((m) => m.t === 'adminState');
    admin.send({ t: 'adminCreateInvite', ttlHours: 2 });
    await admin.waitFor((m) => m.t === 'inviteCreated');
    admin.send({ t: 'adminAudit', limit: 3 });
    const log = await admin.waitFor((m) => m.t === 'auditLog');
    expect(log.entries.length).toBe(3);
    expect(log.entries[0].action).toBe('invite-create'); // prima il piu' recente
    expect(log.entries[0].detail).toContain('id=');
    expect(log.entries.some((e: any) => e.action === 'adminBroadcast' && e.detail?.includes('manutenzione'))).toBe(true);
    expect(log.entries.some((e: any) => e.action === 'adminSetRole' && e.detail?.includes('user1'))).toBe(true);
    expect(log.entries.every((e: any) => e.actor === 'root')).toBe(true);
    admin.ws.close();
  });

  it('adminAudit senza admin -> non autorizzato', async () => {
    const user = await wsWithCookie('user1', 'pw1234'); // user1 è stato alzato a admin sopra: uso una nuova connessione senza login admin
    user.ws.close();
    const accounts = await import('../src/accounts.js');
    accounts.requestAccount('user2', 'pw1234');
    accounts.approveAccount('user2');
    const u2 = await wsWithCookie('user2', 'pw1234');
    u2.send({ t: 'adminAudit' });
    const e = await u2.waitFor((m) => m.t === 'error');
    expect(e.message).toMatch(/non autorizzato/i);
    u2.ws.close();
  });

  it('invito: invite-used / invite-failed nel log; WS login WS -> login', async () => {
    const admin = await wsWithCookie('root', 'root-pw-1');
    admin.send({ t: 'adminCreateInvite' });
    const inv = await admin.waitFor((m) => m.t === 'inviteCreated');
    admin.ws.close();
    const ok = await post('/api/invite', { token: inv.token, username: 'invited1', password: 'pw1234' });
    expect(ok.status).toBe(200);
    const ko = await post('/api/invite', { token: inv.token, username: 'invited2', password: 'pw1234' });
    expect(ko.status).toBe(403);
    // login WS
    const c = await new Promise<{ ws: WebSocket; send: (m: unknown) => void }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on('open', () => resolve({ ws, send: (m) => ws.send(JSON.stringify(m)) }));
    });
    c.send({ t: 'login', username: 'invited1', password: 'pw1234' });
    await new Promise((r) => setTimeout(r, 300));
    c.ws.close();
    const entries = auditMod.readAudit(100);
    expect(entries.some((e) => e.action === 'invite-used' && e.actor === 'invited1')).toBe(true);
    expect(entries.some((e) => e.action === 'invite-failed')).toBe(true);
    expect(entries.some((e) => e.action === 'login' && e.actor === 'invited1')).toBe(true);
  });

  it('rotazione: oltre DND5E_AUDIT_MAX_BYTES il file diventa audit.log.1', () => {
    process.env.DND5E_AUDIT_MAX_BYTES = '400'; // piccolo, solo per questo test
    try {
      for (let i = 0; i < 30; i++) auditMod.audit('test', 'rotation-check', 'x'.repeat(50));
      expect(existsSync(auditMod.AUDIT_FILE + '.1')).toBe(true);
    } finally {
      delete process.env.DND5E_AUDIT_MAX_BYTES;
    }
  });
});
