import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCharacter, type Campaign } from '@dnd5e/core';
import { createSrdRegistry } from '@dnd5e/data-srd';

// e2e del trasporto P2P relay (WebSocket via server LAN): announce → join → welcome → action → state
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-relay-'));

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

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout in attesa della condizione');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('P2P relay transport (senza WebRTC)', () => {
  it('host relay: announce, join con password, action setCharacter, state broadcast', async () => {
    const { P2PDiscovery, P2PRelayHost, P2PRelayClient } = await import('../../../apps/web/src/p2p.js');
    const reg = createSrdRegistry();
    const wsUrl = `ws://127.0.0.1:${port}`;

    const hostDisc = new P2PDiscovery();
    await hostDisc.connect(wsUrl);
    let hostState: Campaign | null = null;
    const host = new P2PRelayHost({
      campaignName: 'Relay Test', password: 'pw', masterName: 'Master', reg, disc: hostDisc,
      cb: { onMessage: () => {}, onState: (c: Campaign) => { hostState = c; }, onPeerJoined: () => {}, onPeerLeft: () => {} }, requireAccept: false,
    });
    hostDisc.announce('Relay Test');

    const jDisc = new P2PDiscovery();
    await jDisc.connect(wsUrl);
    let hosts: { id: string; name: string }[] = [];
    jDisc.onHosts = (h) => { hosts = h; };
    jDisc.list();
    await waitFor(() => hosts.some((h) => h.name === 'Relay Test'));

    const client = new P2PRelayClient(jDisc, hosts.find((h) => h.name === 'Relay Test')!.id);
    let welcomed: any = null;
    const states: Campaign[] = [];
    client.onMessage = (m: any) => {
      if (m.t === 'welcome') welcomed = m;
      if (m.t === 'state') states.push(m.campaign);
    };
    client.join('Eroe', 'pw');
    await waitFor(() => !!welcomed);
    expect(welcomed.you.role).toBe('player');
    expect(welcomed.campaign.name).toBe('Relay Test');

    const ch = createCharacter({
      name: 'Aldric', raceId: 'human', classId: 'fighter',
      abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
      skillChoices: ['athletics'], fightingStyleId: 'defense',
    }, reg).character!;
    client.send({ t: 'action', action: { kind: 'setCharacter', character: ch } });
    await waitFor(() => states.length > 0 && !!states.at(-1)!.characters[welcomed.you.id]);
    expect(states.at(-1)!.characters[welcomed.you.id].name).toBe('Aldric');
    expect(hostState).not.toBeNull();
    expect((hostState as Campaign | null)!.players.length).toBe(2);

    hostDisc.close();
    jDisc.close();
  });

  it('flusso accept del master: pending → acceptJoin → welcome', async () => {
    const { P2PDiscovery, P2PRelayHost, P2PRelayClient } = await import('../../../apps/web/src/p2p.js');
    const reg = createSrdRegistry();
    const wsUrl = `ws://127.0.0.1:${port}`;
    const hostDisc = new P2PDiscovery();
    await hostDisc.connect(wsUrl);
    let pending: { from: string; name: string } | null = null;
    const host = new P2PRelayHost({
      campaignName: 'Relay Accept', password: 'pw', masterName: 'M', reg, disc: hostDisc, requireAccept: true,
      cb: { onMessage: () => {}, onState: () => {}, onPeerJoined: () => {}, onPeerLeft: () => {}, onJoinPending: (r) => { pending = r; } },
    });
    hostDisc.announce('Relay Accept');
    const jDisc = new P2PDiscovery();
    await jDisc.connect(wsUrl);
    let hosts: { id: string; name: string }[] = [];
    jDisc.onHosts = (h) => { hosts = h; };
    jDisc.list();
    await waitFor(() => hosts.some((h) => h.name === 'Relay Accept'));
    const client = new P2PRelayClient(jDisc, hosts.find((h) => h.name === 'Relay Accept')!.id);
    let welcomed: any = null;
    client.onMessage = (m: any) => { if (m.t === 'welcome') welcomed = m; };
    client.join('Eroe', 'pw');
    await waitFor(() => !!pending);
    expect(pending!.name).toBe('Eroe');
    expect(welcomed).toBeNull(); // non entra finché il master non accetta
    host.acceptJoin(pending!.from);
    await waitFor(() => !!welcomed);
    expect(welcomed.you.name).toBe('Eroe');
    hostDisc.close();
    jDisc.close();
  });

  it('password sbagliata → error, niente welcome', async () => {
    const { P2PDiscovery, P2PRelayHost, P2PRelayClient } = await import('../../../apps/web/src/p2p.js');
    const reg = createSrdRegistry();
    const wsUrl = `ws://127.0.0.1:${port}`;
    const hostDisc = new P2PDiscovery();
    await hostDisc.connect(wsUrl);
    new P2PRelayHost({
      campaignName: 'Relay PW', password: 'giusta', masterName: 'M', reg, disc: hostDisc,
      cb: { onMessage: () => {}, onState: () => {}, onPeerJoined: () => {}, onPeerLeft: () => {} }, requireAccept: false,
    });
    hostDisc.announce('Relay PW');
    const jDisc = new P2PDiscovery();
    await jDisc.connect(wsUrl);
    let hosts: { id: string; name: string }[] = [];
    jDisc.onHosts = (h) => { hosts = h; };
    jDisc.list();
    await waitFor(() => hosts.some((h) => h.name === 'Relay PW'));
    const client = new P2PRelayClient(jDisc, hosts.find((h) => h.name === 'Relay PW')!.id);
    let err: string | null = null;
    let welcomed = false;
    client.onMessage = (m: any) => { if (m.t === 'error') err = m.message; if (m.t === 'welcome') welcomed = true; };
    client.join('Intruso', 'sbagliata');
    await waitFor(() => !!err);
    expect(err).toMatch(/password/i);
    expect(welcomed).toBe(false);
    hostDisc.close();
    jDisc.close();
  });
});
