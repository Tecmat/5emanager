import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

/**
 * Registrazione "solo su invito" (invite):
 *  - adminCreateInvite (WS admin) -> link /invite?token=… univoco, a scadenza, monouso
 *  - GET /api/invite?token -> validita'; POST /api/invite -> crea account + cookie + marca l'invito usato
 *  - riuso / scadenza / token sbagliato -> 403; in modalita' invite /api/register e' chiuso
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-invite-'));
const STATIC = mkdtempSync(join(tmpdir(), 'dnd5e-static-'));
mkdirSync(STATIC, { recursive: true });
writeFileSync(join(STATIC, 'index.html'), '<html><body>APP-5EMANAGER</body></html>');
process.env.DND5E_STATIC_DIR = STATIC;
process.env.DND5E_REQUIRE_AUTH = 'true';
process.env.DND5E_ADMIN_TOKEN = 'adm-tok';
delete process.env.DND5E_REGISTRATION;

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let port: number;
let base: string;

beforeAll(async () => {
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
});

afterAll(async () => {
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function adminWs(): Promise<{ ws: WebSocket; send: (m: unknown) => void; waitFor: (pred: (m: any) => boolean, timeoutMs?: number) => Promise<any> }> {
  const login = await post('/api/login', { username: 'root', password: 'root-pw-1' });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  return new Promise((resolve) => {
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

describe('inviti di registrazione (solo su invito)', () => {
  it('adminCreateInvite -> inviteCreated con token univoco e url /invite?token=…; adminState elenca gli inviti', async () => {
    const c = await adminWs();
    c.send({ t: 'adminCreateInvite', ttlHours: 1 });
    const m = await c.waitFor((x) => x.t === 'inviteCreated');
    expect(m.token.length).toBeGreaterThanOrEqual(32);
    expect(m.url).toBe('/invite?token=' + encodeURIComponent(m.token));
    expect(Date.parse(m.expiresAt)).toBeGreaterThan(Date.now());
    c.send({ t: 'adminList' });
    const st = await c.waitFor((x) => x.t === 'adminState' && x.invites?.length === 1);
    expect(st.invites[0].id).toBe(m.id);
    // un secondo invito ha token diverso (univoco)
    c.send({ t: 'adminCreateInvite' });
    const m2 = await c.waitFor((x) => x.t === 'inviteCreated' && x.id !== m.id);
    expect(m2.token).not.toBe(m.token);
    c.ws.close();
    (globalThis as any).__inviteToken = m.token;
    (globalThis as any).__inviteId = m.id;
    (globalThis as any).__invite2Id = m2.id;
  });

  it('GET /invite e /api/invite sono pubblici (anche senza sessione); /api/invite?token valido -> valid:true', async () => {
    const page = await fetch(base + '/invite');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Invito');
    const tok = (globalThis as any).__inviteToken as string;
    const r = await fetch(base + '/api/invite?token=' + encodeURIComponent(tok));
    const j = await r.json();
    expect(j.valid).toBe(true);
    expect(j.expiresAt).toBeTruthy();
    // token sbagliato -> invalid
    const bad = await (await fetch(base + '/api/invite?token=SBAGLIATO')).json();
    expect(bad).toEqual({ valid: false, reason: 'invalid' });
  });

  it('POST /api/invite con token valido -> account creato + cookie di sessione (auto-login)', async () => {
    const tok = (globalThis as any).__inviteToken as string;
    const r = await post('/api/invite', { token: tok, username: 'newbie', password: 'pw1234', remember: true });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.username).toBe('newbie');
    expect(j.role).toBe('user');
    expect(j.rememberToken).toBeTruthy();
    expect((r.headers.get('set-cookie') ?? '')).toContain('dnd5e_session=');
    // il nuovo account puo' loggarsi
    const login = await post('/api/login', { username: 'newbie', password: 'pw1234' });
    expect(login.status).toBe(200);
  });

  it('invito MONOUSO: dopo l\'uso -> used; un secondo POST con lo stesso token -> 403', async () => {
    const tok = (globalThis as any).__inviteToken as string;
    const chk = await (await fetch(base + '/api/invite?token=' + encodeURIComponent(tok))).json();
    expect(chk).toEqual({ valid: false, reason: 'used' });
    const again = await post('/api/invite', { token: tok, username: 'altro', password: 'pw1234' });
    expect(again.status).toBe(403);
    expect((await again.json()).error).toMatch(/gia usato/i);
  });

  it('invito SCADUTO -> 403 (modifico la scadenza sul file)', async () => {
    const c = await adminWs();
    c.send({ t: 'adminCreateInvite', ttlHours: 1 });
    const m = await c.waitFor((x) => x.t === 'inviteCreated');
    c.ws.close();
    // força la scadenza nel passato
    const accounts = await import('../src/accounts.js');
    const f = accounts.loadAccountsFile();
    const key = Object.keys(f.invites).find((k) => f.invites[k].id === m.id)!;
    f.invites[key].expiresAt = new Date(Date.now() - 1000).toISOString();
    accounts.saveAccountsFile(f);
    const chk = await (await fetch(base + '/api/invite?token=' + encodeURIComponent(m.token))).json();
    expect(chk).toEqual({ valid: false, reason: 'expired' });
    const r = await post('/api/invite', { token: m.token, username: 'tardi', password: 'pw1234' });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/scaduto/i);
  });

  it('adminRevokeInvite revoca un invito valido prima della scadenza', async () => {
    const c = await adminWs();
    c.send({ t: 'adminList' });
    const st = await c.waitFor((x) => x.t === 'adminState');
    const id = (globalThis as any).__invite2Id as string;
    expect(st.invites.some((i: any) => i.id === id)).toBe(true);
    c.send({ t: 'adminRevokeInvite', inviteId: id });
    const st2 = await c.waitFor((x) => x.t === 'adminState' && !x.invites.some((i: any) => i.id === id));
    expect(st2.invites.some((i: any) => i.id === id)).toBe(false);
    c.ws.close();
  });

  it('modalita\' invite: adminSetRegistration invite -> /api/register chiuso (403) e WS register -> errore; /api/info lo riporta', async () => {
    const c = await adminWs();
    c.send({ t: 'adminSetRegistration', mode: 'invite' });
    await c.waitFor((x) => x.t === 'adminState');
    c.send({ t: 'register', username: 'vietato', password: 'pw1234' });
    const e = await c.waitFor((x) => x.t === 'error');
    expect(e.message).toMatch(/solo su invito/i);
    c.ws.close();
    const reg = await post('/api/register', { username: 'vietato2', password: 'pw1234' });
    expect(reg.status).toBe(403);
    expect((await reg.json()).error).toMatch(/solo su invito/i);
    const info = await (await fetch(base + '/api/info')).json();
    expect(info.registration).toBe('invite');
    // gli inviti continuano a funzionare in modalita' invite
    const c2 = await adminWs();
    c2.send({ t: 'adminCreateInvite' });
    const m = await c2.waitFor((x) => x.t === 'inviteCreated');
    c2.ws.close();
    const r = await post('/api/invite', { token: m.token, username: 'da-invito', password: 'pw1234' });
    expect(r.status).toBe(200);
  });
});
