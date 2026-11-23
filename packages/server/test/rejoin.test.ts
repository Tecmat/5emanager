import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { addItem, createCharacter, type Character } from '@dnd5e/core';
import { createSrdRegistry } from '@dnd5e/data-srd';

process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-rejoin-'));
process.env.DND5E_ADMIN_TOKEN = 'test-admin-token';
// grace breve per testare anche la rimozione dopo il periodo di tolleranza
process.env.DND5E_REJOIN_GRACE_MS = '400';

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
            setTimeout(() => {
              const i = waiters.indexOf(w);
              if (i >= 0) {
                waiters.splice(i, 1);
                rej(new Error('timeout in attesa del messaggio'));
              }
            }, timeoutMs);
          }),
      });
    });
  });
}

function makeChar(name: string): Character {
  const reg = createSrdRegistry();
  const res = createCharacter({
    name, raceId: 'human', subraceId: 'human-standard', classId: 'fighter',
    abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
  }, reg);
  if (!res.character) throw new Error(res.errors.join(','));
  return addItem(res.character, { name: 'Spada lunga', kind: 'weapon', quantity: 1, weight: 3, equipped: true, magic: false, attuned: false }).character;
}

describe('riconnessione automatica (token di rientro)', () => {
  it('drop + rientro con token: stesso playerId, scheda conservata, di nuovo online', async () => {
    const master = await connect();
    master.send({ t: 'create', name: 'Master', password: 'pw', campaignName: 'Rejoin', playerToken: 'tok-master' });
    const w = await master.waitFor((m) => m.t === 'welcome');
    const cid = w.campaign.id;

    const p1 = await connect();
    p1.send({ t: 'join', campaignId: cid, password: 'pw', name: 'Aragorn', playerToken: 'tok-aragorn' });
    const w1 = await p1.waitFor((m) => m.t === 'welcome');
    const playerId = w1.you.id;
    expect(w1.you.online).toBe(true);

    // carica una scheda
    p1.send({ t: 'action', action: { kind: 'setCharacter', character: makeChar('Aragorn') } });
    await p1.waitFor((m) => m.t === 'state' && m.campaign.characters[playerId]);

    // drop di rete: chiudi il socket
    p1.ws.close();
    // il master vede il giocatore offline (grace period)
    const st = await master.waitFor((m) => m.t === 'state' && m.campaign.players.find((p: any) => p.id === playerId)?.online === false);
    expect(st.campaign.players.find((p: any) => p.id === playerId).online).toBe(false);
    // la scheda resta
    expect(st.campaign.characters[playerId].name).toBe('Aragorn');

    // rientro automatico con lo stesso token: niente password, stesso playerId
    const p2 = await connect();
    p2.send({ t: 'join', campaignId: cid, password: '', name: 'Aragorn', playerToken: 'tok-aragorn' });
    const w2 = await p2.waitFor((m) => m.t === 'welcome');
    expect(w2.you.id).toBe(playerId);
    expect(w2.you.online).toBe(true);
    expect(w2.campaign.characters[playerId].name).toBe('Aragorn');
    // di nuovo online nel broadcast
    await master.waitFor((m) => m.t === 'state' && m.campaign.players.find((p: any) => p.id === playerId)?.online === true);
    p2.ws.close();
    master.ws.close();
  });

  it('dopo il grace period il giocatore offline viene rimosso', async () => {
    const master = await connect();
    master.send({ t: 'create', name: 'Master', password: 'pw', campaignName: 'Grace', playerToken: 'tok-m2' });
    const w = await master.waitFor((m) => m.t === 'welcome');
    const cid = w.campaign.id;

    const p1 = await connect();
    p1.send({ t: 'join', campaignId: cid, password: 'pw', name: 'Bilbo', playerToken: 'tok-bilbo' });
    const w1 = await p1.waitFor((m) => m.t === 'welcome');
    const pid = w1.you.id;
    p1.ws.close();
    // grace 400ms: poi rimosso
    const st = await master.waitFor((m) => m.t === 'state' && !m.campaign.players.some((p: any) => p.id === pid), 3000);
    expect(st.campaign.players.some((p: any) => p.id === pid)).toBe(false);
    master.ws.close();
  });

  it('dopo il kick il token non vale pi\u00f9 (niente rientro automatico)', async () => {
    const master = await connect();
    master.send({ t: 'create', name: 'Master', password: 'pw', campaignName: 'Kick', playerToken: 'tok-m3' });
    const w = await master.waitFor((m) => m.t === 'welcome');
    const cid = w.campaign.id;

    const p1 = await connect();
    p1.send({ t: 'join', campaignId: cid, password: 'pw', name: 'Frodo', playerToken: 'tok-frodo' });
    const w1 = await p1.waitFor((m) => m.t === 'welcome');
    const pid = w1.you.id;
    await master.waitFor((m) => m.t === 'state' && m.campaign.players.some((p: any) => p.id === pid));

    master.send({ t: 'action', action: { kind: 'kickPlayer', playerId: pid } });
    await p1.waitFor((m) => m.t === 'kicked');
    p1.ws.close();

    // rientro col token: il server non lo riconosce pi\u00f9 -> serve la password
    const p2 = await connect();
    p2.send({ t: 'join', campaignId: cid, password: '', name: 'Frodo', playerToken: 'tok-frodo' });
    const err = await p2.waitFor((m) => m.t === 'error');
    expect(err.message).toMatch(/password/i);
    p2.ws.close();
    master.ws.close();
  });

  it('il master disconnesso pu\u00f2 rientrare col token anche se un altro prova a entrare come master', async () => {
    const master = await connect();
    master.send({ t: 'create', name: 'Master', password: 'pw', campaignName: 'MasterRejoin', playerToken: 'tok-mm' });
    const w = await master.waitFor((m) => m.t === 'welcome');
    const cid = w.campaign.id;
    const mid = w.you.id;
    master.ws.close();

    // un altro dispositivo prova a entrare come master: concesso (il master \u00e8 offline)
    const other = await connect();
    other.send({ t: 'join', campaignId: cid, password: 'pw', name: 'Altro', role: 'master', playerToken: 'tok-altro' });
    await other.waitFor((m) => m.t === 'welcome');

    // il master originale rientra col token: stesso playerId, ruolo master, di nuovo online
    const master2 = await connect();
    master2.send({ t: 'join', campaignId: cid, password: '', name: 'Master', playerToken: 'tok-mm' });
    const w2 = await master2.waitFor((m) => m.t === 'welcome');
    expect(w2.you.id).toBe(mid);
    expect(w2.you.role).toBe('master');
    expect(w2.you.online).toBe(true);
    master2.ws.close();
    other.ws.close();
  });
});
