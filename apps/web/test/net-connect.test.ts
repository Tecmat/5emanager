// @vitest-environment jsdom
/**
 * Test NetClient.connect: la promise deve concludersi SEMPRE esattamente una volta.
 * Regressione: alcuni WebView (WebKitGTK ecc.) segnalano il fallimento solo con onclose,
 * senza onerror — prima onclose cancellava il timeout senza reject, quindi ensureNet()
 * restava appesa per sempre e il pulsante Login non dava alcun feedback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetClient } from '../src/net.js';

class FakeWS {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  static instances: FakeWS[] = [];
  static mode: 'open' | 'error' | 'closeOnly' | 'hang' = 'open';
  fire() {
    if (FakeWS.mode === 'open') { this.readyState = 1; this.onopen?.(); }
    else if (FakeWS.mode === 'error') { this.onerror?.(); this.readyState = 3; this.onclose?.(); }
    else if (FakeWS.mode === 'closeOnly') { this.readyState = 3; this.onclose?.(); }
    // 'hang': nessun evento
  }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
}

beforeEach(() => {
  FakeWS.instances = [];
  FakeWS.mode = 'open';
  (window as unknown as Record<string, unknown>).WebSocket = FakeWS;
  (globalThis as Record<string, unknown>).WebSocket = FakeWS;
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).WebSocket;
});

describe('NetClient.connect', () => {
  it('onopen: risolve e send() invia sul socket aperto', async () => {
    const net = new NetClient();
    const p = net.connect('ws://127.0.0.1:3001');
    FakeWS.instances[0].fire();
    await p;
    net.send({ t: 'login', username: 'mario' });
    expect(FakeWS.instances[0].sent).toEqual([JSON.stringify({ t: 'login', username: 'mario' })]);
  });

  it('onerror: rifiuta con "fallita"', async () => {
    FakeWS.mode = 'error';
    const net = new NetClient();
    const p = net.connect('ws://10.255.255.1:3001');
    FakeWS.instances[0].fire();
    await expect(p).rejects.toThrow('fallita');
  });

  it('REGRESSIONE: solo onclose (senza onerror) rifiuta invece di restare appesa', async () => {
    FakeWS.mode = 'closeOnly';
    const net = new NetClient();
    const closed: unknown[] = [];
    net.onMessage((m) => closed.push(m));
    const p = net.connect('ws://127.0.0.1:3001');
    FakeWS.instances[0].fire();
    await expect(p).rejects.toThrow('chiusa prima');
    expect(closed).toEqual([{ t: 'closed' }]);
  });

  it('timeout: rifiuta dopo 8s se nessun evento (host filtrato)', async () => {
    vi.useFakeTimers();
    FakeWS.mode = 'hang';
    const net = new NetClient();
    const p = net.connect('ws://10.255.255.1:3001');
    const assertion = expect(p).rejects.toThrow('Timeout connessione');
    await vi.advanceTimersByTimeAsync(8100);
    await assertion;
  });

  it('onclose DOPO onopen non rifiuta (connessione chiusa normalmente dopo)', async () => {
    const net = new NetClient();
    const p = net.connect('ws://127.0.0.1:3001');
    const ws = FakeWS.instances[0];
    FakeWS.mode = 'open';
    ws.fire();
    await p;
    ws.readyState = 3;
    ws.onclose?.(); // non deve lanciare rejection non gestita
    await new Promise((r) => setTimeout(r, 20));
  });
});
