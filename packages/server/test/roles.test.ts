import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-roles-'));
process.env.DND5E_ADMIN_TOKEN = 'tok';
process.env.DND5E_ADMIN_USER = 'boss';

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

describe('ruoli admin, gestione utenti/campagne e sync campagne P2P sull\'account', () => {
  it('flusso completo: register/approve con ruoli, login admin automatico, setRole, resetPassword, detail+kick, saveP2PCampaign', async () => {
    const admin = await connect();
    admin.send({ t: 'adminAuth', token: 'tok' });
    await admin.waitFor((m) => m.t === 'adminState');

    const ra = await connect();
    ra.send({ t: 'register', username: 'alice', password: 'pw1234' });
    const rb = await connect();
    rb.send({ t: 'register', username: 'boss', password: 'pw1234' });
    await ra.waitFor((m) => m.t === 'notice');
    await rb.waitFor((m) => m.t === 'notice');

    admin.send({ t: 'adminList' });
    const st1 = await admin.waitFor((m) => m.t === 'adminState' && m.pending.length === 2);
    expect(st1.pending.map((p: any) => p.username).sort()).toEqual(['alice', 'boss']);

    admin.send({ t: 'adminApproveAccount', username: 'alice' });
    admin.send({ t: 'adminApproveAccount', username: 'boss' });
    const st2 = await admin.waitFor((m) => m.t === 'adminState' && m.accounts.length === 2);
    // DND5E_ADMIN_USER=boss -> boss admin, alice user
    expect(st2.accounts.find((a: any) => a.username === 'boss').role).toBe('admin');
    expect(st2.accounts.find((a: any) => a.username === 'alice').role).toBe('user');

    // alice login: NON admin -> adminList rifiutato
    const alice = await connect();
    alice.send({ t: 'login', username: 'alice', password: 'pw1234' });
    await alice.waitFor((m) => m.t === 'auth');
    alice.send({ t: 'adminList' });
    const e1 = await alice.waitFor((m) => m.t === 'error');
    expect(e1.message).toMatch(/Non autorizzato/);

    // boss login: admin automatico dal ruolo
    const boss = await connect();
    boss.send({ t: 'login', username: 'boss', password: 'pw1234' });
    await boss.waitFor((m) => m.t === 'auth');
    boss.send({ t: 'adminList' });
    await boss.waitFor((m) => m.t === 'adminState');

    // promuovi alice
    boss.send({ t: 'adminSetRole', username: 'alice', role: 'admin' });
    const st3 = await boss.waitFor((m) => m.t === 'adminState' && m.accounts.find((a: any) => a.username === 'alice')?.role === 'admin');
    expect(st3.accounts.find((a: any) => a.username === 'alice').role).toBe('admin');

    // reset password alice: la vecchia non vale più, la nuova sì
    boss.send({ t: 'adminResetPassword', username: 'alice', password: 'nuovapw' });
    const alice2 = await connect();
    alice2.send({ t: 'login', username: 'alice', password: 'nuovapw' });
    await alice2.waitFor((m) => m.t === 'auth');
    const alice3 = await connect();
    alice3.send({ t: 'login', username: 'alice', password: 'pw1234' });
    const e2 = await alice3.waitFor((m) => m.t === 'error');
    expect(e2.message).toMatch(/Password errata/);

    // campagna: master + player, poi detail e kick dall'admin
    const master = await connect();
    master.send({ t: 'create', name: 'Master', password: 'cpw', campaignName: 'TestKick' });
    const w = await master.waitFor((m) => m.t === 'welcome');
    const cid = w.campaign.id;
    const player = await connect();
    player.send({ t: 'join', campaignId: cid, password: 'cpw', name: 'Eroe' });
    const wp = await player.waitFor((m) => m.t === 'welcome');

    boss.send({ t: 'adminCampaignDetail', id: cid });
    const det = await boss.waitFor((m) => m.t === 'adminCampaign');
    expect(det.name).toBe('TestKick');
    expect(det.players.length).toBe(2);

    boss.send({ t: 'adminKickPlayer', campaignId: cid, playerId: wp.you.id });
    await player.waitFor((m) => m.t === 'kicked');

    // sync campagna P2P sull'account (login richiesto): save + delete via action
    alice2.send({ t: 'action', action: { kind: 'saveP2PCampaign', saved: { id: 'snap1', name: 'Sessione', savedAt: new Date().toISOString(), campaign: { id: 'snap1', name: 'Sessione', passwordHash: '' } } } });
    const auth2 = await alice2.waitFor((m) => m.t === 'auth' && m.savedCampaigns?.length === 1);
    expect(auth2.savedCampaigns[0].id).toBe('snap1');
    alice2.send({ t: 'action', action: { kind: 'deleteP2PCampaign', id: 'snap1' } });
    await alice2.waitFor((m) => m.t === 'auth' && (m.savedCampaigns?.length ?? 0) === 0);
  });
});
