import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { totpAt, totpNow } from '../src/totp.js';

process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-totp-'));
process.env.DND5E_ADMIN_TOKEN = 'tok';

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let port: number;

beforeAll(async () => {
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  port = server.port;
});

afterAll(async () => {
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

interface Client {
  ws: WebSocket;
  messages: any[];
  send: (m: unknown) => void;
  waitFor: (pred: (m: any) => boolean, timeoutMs?: number) => Promise<any>;
}

function connect(): Promise<Client> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: any[] = [];
    const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      messages.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(m)) {
          waiters[i].resolve(m);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on('open', () => {
      resolve({
        ws,
        messages,
        send: (m) => ws.send(JSON.stringify(m)),
        waitFor: (pred, timeoutMs = 4000) =>
          new Promise((res, rej) => {
            const found = messages.find(pred);
            if (found) return res(found);
            const w = { pred, resolve: res };
            waiters.push(w);
            setTimeout(() => rej(new Error('timeout in attesa del messaggio')), timeoutMs);
          }),
      });
    });
  });
}

describe('2FA TOTP: setup -> enable -> login in due passi -> backup monouso -> throttle', () => {
  it('flusso completo', async () => {
    const admin = await connect();
    admin.send({ t: 'adminAuth', token: 'tok' });
    await admin.waitFor((m) => m.t === 'adminState');
    const reg = await connect();
    reg.send({ t: 'register', username: 'alice', password: 'pw1234' });
    await reg.waitFor((m) => m.t === 'notice');
    admin.send({ t: 'adminApproveAccount', username: 'alice' });
    await admin.waitFor((m) => m.t === 'adminState' && m.accounts.length === 1);

    // login normale: senza 2FA ancora → auth diretta con totpEnabled false
    const c1 = await connect();
    c1.send({ t: 'login', username: 'alice', password: 'pw1234' });
    const a1 = await c1.waitFor((m) => m.t === 'auth');
    expect(a1.totpEnabled).toBe(false);

    // setup: secret + otpauth + 8 backup
    c1.send({ t: 'setupTotp' });
    const setup = await c1.waitFor((m) => m.t === 'totpSetup');
    expect(setup.secret.length).toBeGreaterThanOrEqual(32);
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    expect(setup.backupCodes).toHaveLength(8);

    // enable con codice sbagliato → errore; con quello giusto (finestra ±1) → auth totpEnabled
    c1.send({ t: 'enableTotp', code: 'abcdef' });
    const e1 = await c1.waitFor((m) => m.t === 'error');
    expect(e1.message).toMatch(/Codice non valido/);
    const goodCode = totpNow(setup.secret);
    c1.send({ t: 'enableTotp', code: goodCode });
    const a2 = await c1.waitFor((m) => m.t === 'auth' && m.totpEnabled === true);
    expect(a2.username).toBe('alice');

    // login ora chiede il codice: password da sola → totpRequired
    const c2 = await connect();
    c2.send({ t: 'login', username: 'alice', password: 'pw1234' });
    const req = await c2.waitFor((m) => m.t === 'totpRequired');
    expect(req.username).toBe('alice');
    // codice errato → error
    c2.send({ t: 'loginTotp', username: 'alice', password: 'pw1234', code: '000000' });
    const wrong = totpAt(setup.secret, Date.now() - 10 * 30_000); // fuori finestra
    c2.send({ t: 'loginTotp', username: 'alice', password: 'pw1234', code: wrong });
    const e2 = await c2.waitFor((m) => m.t === 'error');
    expect(e2.message).toMatch(/Codice 2FA non valido/);
    // codice giusto → auth
    c2.send({ t: 'loginTotp', username: 'alice', password: 'pw1234', code: totpNow(setup.secret) });
    const a3 = await c2.waitFor((m) => m.t === 'auth');
    expect(a3.totpEnabled).toBe(true);

    // backup: primo uso ok, riuso → errore
    const c3 = await connect();
    c3.send({ t: 'loginTotpBackup', username: 'alice', password: 'pw1234', backupCode: setup.backupCodes[0] });
    await c3.waitFor((m) => m.t === 'auth');
    const c4 = await connect();
    c4.send({ t: 'loginTotpBackup', username: 'alice', password: 'pw1234', backupCode: setup.backupCodes[0] });
    const e3 = await c4.waitFor((m) => m.t === 'error');
    expect(e3.message).toMatch(/backup non valido/i);

    // throttle: 5 tentativi sbagliati in un minuto → sesto bloccato
    const c5 = await connect();
    for (let i = 0; i < 5; i++) {
      c5.send({ t: 'loginTotp', username: 'alice', password: 'pw1234', code: '999999' });
      await c5.waitFor((m) => m.t === 'error');
    }
    c5.send({ t: 'loginTotp', username: 'alice', password: 'pw1234', code: totpNow(setup.secret) });
    const e4 = await c5.waitFor((m) => m.t === 'error' && /Troppi tentativi/.test(m.message));
    expect(e4.message).toMatch(/Troppi tentativi/);

    // disable: password richiesta
    c2.send({ t: 'disableTotp', password: 'pw-sbagliata' });
    const e5 = await c2.waitFor((m) => m.t === 'error' && /Password errata/.test(m.message));
    expect(e5).toBeTruthy();
    c2.send({ t: 'disableTotp', password: 'pw1234' });
    const a4 = await c2.waitFor((m) => m.t === 'auth' && m.totpEnabled === false);
    expect(a4.totpEnabled).toBe(false);
    // ora il login torna diretto
    const c6 = await connect();
    c6.send({ t: 'login', username: 'alice', password: 'pw1234' });
    const a5 = await c6.waitFor((m) => m.t === 'auth' && m.totpEnabled === false);
    expect(a5.username).toBe('alice');
  });
});
