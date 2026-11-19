import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

// test di regressione del relay di discovery P2P: announce → list → join → offer → answer
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-p2p-relay-'));

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

function connect(): Promise<{ ws: WebSocket; msgs: any[]; send: (m: unknown) => void; waitFor: (pred: (m: any) => boolean) => Promise<any> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msgs: any[] = [];
    const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      msgs.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(m)) {
          waiters[i].resolve(m);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on('open', () =>
      resolve({
        ws,
        msgs,
        send: (m) => ws.send(JSON.stringify(m)),
        waitFor: (pred) =>
          new Promise((res, rej) => {
            const found = msgs.find(pred);
            if (found) return res(found);
            waiters.push({ pred, resolve: res });
            setTimeout(() => rej(new Error('timeout in attesa del messaggio')), 5000);
          }),
      }),
    );
  });
}

describe('relay discovery P2P + /api/info', () => {
  it('GET /api/info risponde con app=5emanager, nome host e lan', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/info`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.app).toBe('5emanager');
    expect(typeof j.name).toBe('string');
    expect(Array.isArray(j.lan)).toBe(true);
  });

  it('announce → list → join → offer → answer', async () => {
    const host = await connect();
    host.send({ t: 'p2pAnnounce', name: 'Campagna Test' });

    const joiner = await connect();
    joiner.send({ t: 'p2pList' });
    const hosts = await joiner.waitFor((m) => m.t === 'p2pHosts' && m.hosts.length > 0);
    expect(hosts.hosts[0].name).toBe('Campagna Test');
    expect(hosts.hosts[0].ip).toBe('127.0.0.1'); // IP del client dal socket
    const hostId = hosts.hosts[0].id;

    joiner.send({ t: 'p2pJoin', hostId });
    const jr = await host.waitFor((m) => m.t === 'p2pJoinRequest');
    expect(jr.from).toBeTruthy();

    host.send({ t: 'p2pOffer', to: jr.from, code: 'OFFER123' });
    const offer = await joiner.waitFor((m) => m.t === 'p2pOffer');
    expect(offer.code).toBe('OFFER123');
    expect(offer.name).toBe('Campagna Test');

    joiner.send({ t: 'p2pAnswer', to: offer.from, code: 'ANSWER456' });
    const ans = await host.waitFor((m) => m.t === 'p2pAnswer');
    expect(ans.code).toBe('ANSWER456');

    host.ws.close();
    joiner.ws.close();
  });

  it('join verso host inesistente → errore', async () => {
    const c = await connect();
    c.send({ t: 'p2pJoin', hostId: 'non-esiste' });
    const err = await c.waitFor((m) => m.t === 'error');
    expect(err.message).toMatch(/non trovato/i);
    c.ws.close();
  });
});
