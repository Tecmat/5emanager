import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createCharacter, type Character } from '@dnd5e/core';
import { createSrdRegistry } from '@dnd5e/data-srd';

process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-test-'));

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
        waitFor: (pred, timeoutMs = 3000) =>
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

function makeChar(name: string, classId: string): Character {
  const reg = createSrdRegistry();
  const res = createCharacter({
    name, raceId: 'human', subraceId: 'human-standard', classId,
    abilityScores: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
  }, reg);
  if (!res.character) throw new Error(res.errors.join(','));
  return res.character;
}

describe('server multiplayer', () => {
  it('flusso completo: crea campagna, join, carica PG, combattimento con nemici', async () => {
    const master = await connect();
    master.send({ t: 'create', name: 'DM', password: 'segreta', campaignName: 'La tomba perduta' });
    const welcome = await master.waitFor((m) => m.t === 'welcome');
    const campaignId: string = welcome.campaign.id;
    expect(welcome.you.role).toBe('master');

    const player = await connect();
    player.send({ t: 'join', campaignId, password: 'segreta', name: 'Eroe' });
    const pw = await player.waitFor((m) => m.t === 'welcome');
    expect(pw.you.role).toBe('player');

    const wrong = await connect();
    wrong.send({ t: 'join', campaignId, password: 'sbagliata', name: 'X' });
    const err = await wrong.waitFor((m) => m.t === 'error');
    expect(err.message).toContain('Password');
    wrong.ws.close();

    // entrambi caricano il personaggio
    master.send({ t: 'action', action: { kind: 'setCharacter', character: makeChar('DM-Guerriero', 'fighter') } });
    player.send({ t: 'action', action: { kind: 'setCharacter', character: makeChar('Eroe', 'wizard') } });
    await master.waitFor((m) => m.t === 'state' && Object.keys(m.campaign.characters).length === 2);

    // il master inizia il combattimento
    master.send({ t: 'action', action: { kind: 'startCombat' } });
    let st = await player.waitFor((m) => m.t === 'state' && m.campaign.combat !== null);
    expect(st.campaign.combat.combatants).toHaveLength(2);

    // master aggiunge 2 goblin
    master.send({ t: 'action', action: { kind: 'addEnemy', enemyId: 'goblin', count: 2 } });
    st = await player.waitFor((m) => m.t === 'state' && m.campaign.combat && m.campaign.combat.combatants.length === 4);
    expect(st.campaign.combat.combatants.filter((c: any) => c.name.startsWith('Goblin'))).toHaveLength(2);

    // chi ha il turno attacca un bersaglio
    const combat = st.campaign.combat;
    const cur = combat.combatants[combat.turnIndex];
    const target = combat.combatants.find((c: any) => c.id !== cur.id)!;
    const actor = cur.isPlayer
      ? (cur.name === 'DM-Guerriero' ? master : player)
      : master;
    actor.send({ t: 'action', action: { kind: 'attack', targetId: target.id, attackIndex: 0 } });
    st = await player.waitFor((m) => m.t === 'state' && m.campaign.combat && m.campaign.combat.log.some((l: string) => l.includes('🗡️')));
    expect(st.campaign.combat.combatants.find((c: any) => c.id === cur.id).actionUsed).toBe(true);

    // il master passa il turno e poi termina
    master.send({ t: 'action', action: { kind: 'nextTurn' } });
    st = await player.waitFor((m) => m.t === 'state' && m.campaign.combat && m.campaign.combat.log.some((l: string) => l.includes('▶️')));
    master.send({ t: 'action', action: { kind: 'endCombat' } });
    st = await player.waitFor((m) => m.t === 'state' && m.campaign.combat === null);
    expect(st.campaign.combat).toBeNull();

    master.ws.close();
    player.ws.close();
  }, 15000);
});
