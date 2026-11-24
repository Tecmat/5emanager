import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-passkeys-'));
process.env.DND5E_ADMIN_TOKEN = 'tok';
process.env.DND5E_ADMIN_USER = 'boss';

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let port: number;
let accounts: typeof import('../src/accounts.js');
let passkeys: typeof import('../src/passkeys.js');

beforeAll(async () => {
  accounts = await import('../src/accounts.js');
  passkeys = await import('../src/passkeys.js');
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
            waiters.push({ pred, resolve: res });
            setTimeout(() => rej(new Error('timeout in attesa del messaggio')), timeoutMs);
          }),
      });
    });
  });
}

describe('accounts v9 + passkey (unita)', () => {
  it('migra un file v5 a v9 aggiungendo passkeys: [], invites: {}, rememberTokens record e settings', () => {
    writeFileSync(
      accounts.ACCOUNTS_FILE,
      JSON.stringify({
        v: 5,
        accounts: {
          bob: { username: 'bob', passwordHash: 'x', characters: {}, createdAt: '2026-01-01', role: 'user', savedP2PCampaigns: {}, totp: null },
        },
        pending: {},
      }),
    );
    const f = accounts.loadAccountsFile();
    expect(f.v).toBe(9);
    expect(f.settings).toEqual({});
    expect(f.invites).toEqual({});
    expect(f.accounts.bob.passkeys).toEqual([]);
    expect(f.accounts.bob.rememberTokens).toEqual([]);
  });

  it('add/list/get/remove/find/updateCounter delle passkey', () => {
    const pk = { id: 'cred-1', publicKeyB64: 'AAAA', counter: 0, name: 'Passkey 2026-11-21', createdAt: '2026-11-21' };
    accounts.addAccountPasskey('bob', pk);
    expect(accounts.listAccountPasskeys('bob')).toHaveLength(1);
    expect(accounts.listAccountPasskeys('bob')[0]).not.toHaveProperty('publicKeyB64');
    expect(accounts.getAccountPasskey('bob', 'cred-1')?.publicKeyB64).toBe('AAAA');
    expect(accounts.findPasskeyOwner('cred-1')?.username).toBe('bob');
    expect(accounts.findPasskeyOwner('sconosciuta')).toBeUndefined();
    accounts.updatePasskeyCounter('bob', 'cred-1', 7);
    expect(accounts.getAccountPasskey('bob', 'cred-1')?.counter).toBe(7);
    expect(accounts.removeAccountPasskey('bob', 'cred-1')).toBe(true);
    expect(accounts.removeAccountPasskey('bob', 'cred-1')).toBe(false);
    expect(accounts.listAccountPasskeys('bob')).toHaveLength(0);
  });

  it('rpConfigFromHost: env, localhost http, dominio https (niente :443)', () => {
    const savedId = process.env.DND5E_RP_ID;
    const savedOrigin = process.env.DND5E_RP_ORIGIN;
    delete process.env.DND5E_RP_ID;
    delete process.env.DND5E_RP_ORIGIN;
    expect(passkeys.rpConfigFromHost('localhost:3001')).toMatchObject({ rpID: 'localhost', origin: 'http://localhost:3001' });
    expect(passkeys.rpConfigFromHost('dnd.example.com:443')).toMatchObject({ rpID: 'dnd.example.com', origin: 'https://dnd.example.com' });
    process.env.DND5E_RP_ID = 'login.example.com';
    process.env.DND5E_RP_ORIGIN = 'https://login.example.com';
    expect(passkeys.rpConfigFromHost('ignorato:1234')).toMatchObject({ rpID: 'login.example.com', origin: 'https://login.example.com' });
    if (savedId === undefined) delete process.env.DND5E_RP_ID; else process.env.DND5E_RP_ID = savedId;
    if (savedOrigin === undefined) delete process.env.DND5E_RP_ORIGIN; else process.env.DND5E_RP_ORIGIN = savedOrigin;
  });

  it('registrationOptionsFor: rp, user, challenge, excludeCredentials', async () => {
    const rp = { rpName: '5e Manager', rpID: 'localhost', origin: 'http://localhost:3001' };
    const opts = await passkeys.registrationOptionsFor('bob', [{ id: 'cred-1', publicKeyB64: 'AAAA', counter: 0, name: 'x', createdAt: '' }], rp);
    expect(opts.rp.id).toBe('localhost');
    expect(opts.rp.name).toBe('5e Manager');
    expect(opts.user.name).toBe('bob');
    expect(typeof opts.challenge).toBe('string');
    expect(opts.challenge.length).toBeGreaterThan(20);
    expect(opts.excludeCredentials?.map((c) => c.id)).toEqual(['cred-1']);
  });

  it('authenticationOptionsFor: allowCredentials solo se username noto', async () => {
    const rp = { rpName: '5e Manager', rpID: 'localhost', origin: 'http://localhost:3001' };
    const withUser = await passkeys.authenticationOptionsFor(rp, [{ id: 'cred-1', publicKeyB64: 'AAAA', counter: 0, name: 'x', createdAt: '' }]);
    expect(withUser.allowCredentials?.map((c) => c.id)).toEqual(['cred-1']);
    expect(withUser.rpId).toBe('localhost');
    const discoverable = await passkeys.authenticationOptionsFor(rp, undefined);
    expect(discoverable.allowCredentials ?? []).toEqual([]);
  });
});

describe('flusso WS passkey', () => {
  it('register senza login -> errore; poi account alice: login, options, list, remove', async () => {
    const anon = await connect();
    anon.send({ t: 'passkeyRegisterStart' });
    const err1 = await anon.waitFor((m) => m.t === 'error');
    expect(err1.message).toMatch(/login/i);
    anon.ws.close();

    const c = await connect();
    c.send({ t: 'register', username: 'alice', password: 'pw123' });
    await c.waitFor((m) => m.t === 'notice');
    c.send({ t: 'adminAuth', token: 'tok' });
    await c.waitFor((m) => m.t === 'adminState');
    c.send({ t: 'adminApproveAccount', username: 'alice' });
    await c.waitFor((m) => m.t === 'adminState' && m.accounts.some((a: any) => a.username === 'alice'));
    c.send({ t: 'login', username: 'alice', password: 'pw123' });
    await c.waitFor((m) => m.t === 'auth');

    // register start (loggato) -> options con challenge
    c.send({ t: 'passkeyRegisterStart' });
    const regOpts = await c.waitFor((m) => m.t === 'passkeyRegisterOptions');
    expect(regOpts.options.challenge).toBeTruthy();
    expect(regOpts.options.user.name).toBe('alice');

    // login start con username -> allowCredentials vuota (alice non ha passkey) ma richiesta accettata? no: errore "nessuna passkey"
    c.send({ t: 'passkeyLoginStart', username: 'alice' });
    const errNoPk = await c.waitFor((m) => m.t === 'error');
    expect(errNoPk.message).toMatch(/Nessuna passkey/i);

    // login start senza username -> options discoverable
    c.send({ t: 'passkeyLoginStart' });
    const loginOpts = await c.waitFor((m) => m.t === 'passkeyLoginOptions');
    expect(loginOpts.options.rpId).toBe('127.0.0.1');
    expect(loginOpts.options.allowCredentials ?? []).toEqual([]);

    // login start con username inesistente -> errore
    c.send({ t: 'passkeyLoginStart', username: 'nonesiste' });
    const err2 = await c.waitFor((m) => m.t === 'error' && /Account non trovato/.test(m.message));
    expect(err2.message).toMatch(/Account non trovato/);

    // list (vuota) e remove (non trovata)
    c.send({ t: 'passkeyList' });
    const list = await c.waitFor((m) => m.t === 'passkeyList');
    expect(list.passkeys).toEqual([]);
    c.send({ t: 'passkeyRemove', credentialId: 'nope' });
    const err3 = await c.waitFor((m) => m.t === 'error' && /non trovata/.test(m.message));
    expect(err3.message).toMatch(/non trovata/);

    // register finish senza challenge valida -> errore di verifica (response finto)
    c.send({ t: 'passkeyRegisterFinish', response: { id: 'x', response: {} } });
    const err4 = await c.waitFor((m) => m.t === 'error');
    expect(err4.message.length).toBeGreaterThan(5);

    c.ws.close();
  });
});
