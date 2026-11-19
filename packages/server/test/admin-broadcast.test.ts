import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

// test adminBroadcast: un client admin (adminAuth) manda un notice a tutti i client connessi
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-admin-'));

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

describe('admin broadcast', () => {
  it('senza adminAuth adminBroadcast viene rifiutato', async () => {
    const c = await connect();
    c.send({ t: 'adminBroadcast', message: 'ciao' });
    const m = await c.waitFor((x) => x.t === 'error');
    expect(m.message).toMatch(/autorizzato/i);
    c.ws.close();
  });

  it('dopo adminAuth il messaggio arriva come notice a tutti i client', async () => {
    const admin = await connect();
    admin.send({ t: 'adminAuth', token: '' });
    await admin.waitFor((x) => x.t === 'adminState');
    const user = await connect();
    admin.send({ t: 'adminBroadcast', message: 'manutenzione alle 22:00' });
    const n = await user.waitFor((x) => x.t === 'notice');
    expect(n.message).toContain('manutenzione alle 22:00');
    const n2 = await admin.waitFor((x) => x.t === 'notice');
    expect(n2.message).toContain('[admin]');
    admin.ws.close();
    user.ws.close();
  });
});
