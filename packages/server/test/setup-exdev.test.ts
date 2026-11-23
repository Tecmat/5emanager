import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-setup-'));
// NB: DND5E_ADMIN_TOKEN volutamente NON impostato a import: il test lo imposta a runtime
// per verificare il 401 di /api/setup (l'handler lo legge a ogni richiesta).

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let port: number;

beforeAll(async () => {
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  port = server.port;
});

afterAll(async () => {
  delete process.env.DND5E_ADMIN_TOKEN;
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

const base = () => `http://127.0.0.1:${port}`;

describe('moveDir: EXDEV-safe (overlayfs Docker)', () => {
  it('sposta normalmente con rename quando va bene', async () => {
    const { moveDir } = await import('../src/update-api.js');
    const dir = mkdtempSync(join(tmpdir(), 'movedir-'));
    const src = join(dir, 'a');
    const dst = join(dir, 'b');
    mkdirSync(src);
    writeFileSync(join(src, 'f.txt'), 'ciao');
    moveDir(src, dst);
    expect(existsSync(src)).toBe(false);
    expect(readFileSync(join(dst, 'f.txt'), 'utf8')).toBe('ciao');
    rmSync(dir, { recursive: true, force: true });
  });

  it('su EXDEV (rename di dir dei layer Docker) fa copia ricorsiva + rimozione', async () => {
    const { moveDir } = await import('../src/update-api.js');
    const dir = mkdtempSync(join(tmpdir(), 'movedir-'));
    const src = join(dir, 'dist');
    const dst = join(dir, 'dist.bak');
    mkdirSync(join(src, 'assets'), { recursive: true });
    writeFileSync(join(src, 'index.html'), '<html></html>');
    writeFileSync(join(src, 'assets', 'x.js'), '1');
    const exdev = (() => {
      const e = new Error('cross-device link not permitted') as NodeJS.ErrnoException;
      e.code = 'EXDEV';
      return e;
    });
    moveDir(src, dst, () => {
      throw exdev();
    });
    expect(existsSync(src)).toBe(false);
    expect(readFileSync(join(dst, 'index.html'), 'utf8')).toBe('<html></html>');
    expect(readFileSync(join(dst, 'assets', 'x.js'), 'utf8')).toBe('1');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('setup iniziale + role admin + statistiche login', () => {
  it('GET /setup serve la pagina e /api/setup dice che serve il setup', async () => {
    const page = await fetch(`${base()}/setup`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Setup iniziale');
    const st = await (await fetch(`${base()}/api/setup`)).json();
    expect(st).toEqual({ setupRequired: true, tokenRequired: false });
  });

  it('POST /api/setup crea il primo admin; il secondo tentativo e 403', async () => {
    const r1 = await fetch(`${base()}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'segreto123' }),
    });
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1).toMatchObject({ ok: true, username: 'root', role: 'admin' });

    const r2 = await fetch(`${base()}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'altro', password: 'segreto123' }),
    });
    expect(r2.status).toBe(403);

    const st = await (await fetch(`${base()}/api/setup`)).json();
    expect(st.setupRequired).toBe(false);
  });

  it('con DND5E_ADMIN_TOKEN impostato, /api/setup senza token e 401 (anti race su server pubblico)', async () => {
    process.env.DND5E_ADMIN_TOKEN = 'tok-segreto';
    try {
      // primeiro admin gia' esiste -> 403 anche con token? no: senza token -> 401 prima
      const r = await fetch(`${base()}/api/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'x', password: 'yyyy' }),
      });
      expect(r.status).toBe(401);
    } finally {
      delete process.env.DND5E_ADMIN_TOKEN;
    }
  });

  it('login come admin -> auth con role admin; loginCount/lastLoginAt tracciati; adminState esteso', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => (ws.on('open', r)));
    ws.send(JSON.stringify({ t: 'login', username: 'root', password: 'segreto123' }));
    await new Promise((r) => setTimeout(r, 300));
    const auth = msgs.find((m) => m.t === 'auth');
    expect(auth).toBeTruthy();
    expect(auth.role).toBe('admin');
    expect(auth.username).toBe('root');

    // adminState con statistiche
    ws.send(JSON.stringify({ t: 'adminAuth', token: '' }));
    ws.send(JSON.stringify({ t: 'adminList' }));
    await new Promise((r) => setTimeout(r, 300));
    const st = msgs.find((m) => m.t === 'adminState');
    expect(st).toBeTruthy();
    const acc = st.accounts.find((a: any) => a.username === 'root');
    expect(acc.role).toBe('admin');
    expect(acc.loginCount).toBe(1);
    expect(typeof acc.lastLoginAt).toBe('string');
    expect(st.server).toHaveProperty('characters');
    expect(st.server).toHaveProperty('p2pCampaigns');
    ws.close();
  });

  it('login come user normale -> role user', async () => {
    // registra+approva un user via API diritte del modulo accounts
    const accounts = await import('../src/accounts.js');
    accounts.requestAccount('giocatore', 'pw1234');
    accounts.approveAccount('giocatore');
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => (ws.on('open', r)));
    ws.send(JSON.stringify({ t: 'login', username: 'giocatore', password: 'pw1234' }));
    await new Promise((r) => setTimeout(r, 300));
    const auth = msgs.find((m) => m.t === 'auth');
    expect(auth.role).toBe('user');
    ws.close();
  });
});
