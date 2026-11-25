import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

/**
 * Hardening per l'esposizione HTTPS pubblica:
 *  - /.well-known/security.txt sempre pubblico (anche con REQUIRE_AUTH e senza sessione)
 *  - DND5E_ADMIN_ALLOWLIST: /admin, adminAuth WS e /api/update/apply -> 403 se l'IP non è in lista
 *  - /api/info espone adminAllowlist
 *  - rate limit configurabile su /api/register (DND5E_REGISTER_MAX_ATTEMPTS)
 *  - audit 'admin-login-no-2fa' quando un admin entra con password ma senza TOTP/passkey
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-hardening-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP-5EMANAGER</body></html>');
process.env.DND5E_STATIC_DIR = STATIC;
process.env.DND5E_REQUIRE_AUTH = 'true';
process.env.DND5E_ADMIN_TOKEN = 'adm-tok';
process.env.DND5E_GH_API = 'http://127.0.0.1:1'; // irraggiungibile: niente chiamate reali a GitHub
delete process.env.DND5E_REGISTRATION;

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let base: string;
let auditMod: typeof import('../src/audit.js');

beforeAll(async () => {
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.port}`;
  auditMod = await import('../src/audit.js');
  const r = await fetch(base + '/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'adm-tok' },
    body: JSON.stringify({ username: 'root', password: 'root-pw-1' }),
  });
  expect(r.status).toBe(200);
});

afterAll(async () => {
  delete process.env.DND5E_ADMIN_ALLOWLIST;
  delete process.env.DND5E_REGISTER_MAX_ATTEMPTS;
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

async function adminCookie(): Promise<string> {
  const r = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'root-pw-1' }),
  });
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

function wsWait(ws: WebSocket, pred: (m: any) => boolean, ms = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout ws')), ms);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (pred(m)) { clearTimeout(to); resolve(m); }
    });
  });
}

describe('security.txt', () => {
  it('/.well-known/security.txt è pubblico anche con REQUIRE_AUTH e senza cookie', async () => {
    const r = await fetch(base + '/.well-known/security.txt');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
    const body = await r.text();
    expect(body).toContain('Contact:');
    expect(body).toContain('Expires:');
    expect(body).toContain('SECURITY.md');
  });
});

describe('DND5E_ADMIN_ALLOWLIST', () => {
  it('/api/info espone adminAllowlist', async () => {
    delete process.env.DND5E_ADMIN_ALLOWLIST;
    let j = await (await fetch(base + '/api/info')).json();
    expect(j.adminAllowlist).toBe(false);
    process.env.DND5E_ADMIN_ALLOWLIST = '10.1.2.0/24';
    j = await (await fetch(base + '/api/info')).json();
    expect(j.adminAllowlist).toBe(true);
  });

  it('IP non in lista: /admin -> 403 anche con sessione admin valida', async () => {
    process.env.DND5E_ADMIN_ALLOWLIST = '10.1.2.0/24';
    const cookie = await adminCookie();
    const r = await fetch(base + '/admin', { headers: { cookie } });
    expect(r.status).toBe(403);
  });

  it('IP non in lista: adminAuth WS -> errore, nessun adminState', async () => {
    process.env.DND5E_ADMIN_ALLOWLIST = '10.1.2.0/24';
    const cookie = await adminCookie();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { headers: { cookie } });
    await new Promise((r) => ws.on('open', r));
    const errP = wsWait(ws, (m) => m.t === 'error');
    ws.send(JSON.stringify({ t: 'adminAuth', token: 'adm-tok' }));
    const m = await errP;
    expect(m.message).toMatch(/IP non autorizzato/);
    ws.close();
  });

  it('IP non in lista: /api/update/apply -> 403', async () => {
    process.env.DND5E_ADMIN_ALLOWLIST = '10.1.2.0/24';
    const r = await fetch(base + '/api/update/apply', { method: 'POST', headers: { 'x-admin-token': 'adm-tok' } });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/IP non autorizzato/);
  });

  it('IP in lista (127.0.0.0/8): /admin con sessione admin -> 200', async () => {
    process.env.DND5E_ADMIN_ALLOWLIST = '127.0.0.0/8, ::1';
    const cookie = await adminCookie();
    const r = await fetch(base + '/admin', { headers: { cookie } });
    expect(r.status).toBe(200);
    delete process.env.DND5E_ADMIN_ALLOWLIST;
  });
});

describe('rate limit configurabile', () => {
  it('/api/register: oltre DND5E_REGISTER_MAX_ATTEMPTS fallimenti -> 429', async () => {
    process.env.DND5E_REGISTER_MAX_ATTEMPTS = '2';
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await fetch(base + '/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'u' + i, password: 'pw123456' }),
      });
      codes.push(r.status);
    }
    expect(codes[2]).toBe(429);
    delete process.env.DND5E_REGISTER_MAX_ATTEMPTS;
  });
});

describe('audit 2FA admin', () => {
  it('login admin senza TOTP/passkey -> evento admin-login-no-2fa nell\'audit log', async () => {
    await adminCookie(); // login admin (root non ha 2FA)
    const entries = auditMod.readAudit(50);
    expect(entries.some((e) => e.action === 'admin-login-no-2fa' && e.actor === 'root')).toBe(true);
  });
});
