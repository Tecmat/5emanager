import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { addItem, createCharacter, type Character } from '@dnd5e/core';
import { createSrdRegistry } from '@dnd5e/data-srd';

process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-test-'));
process.env.DND5E_ADMIN_TOKEN = 'test-admin-token';

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
  // equipaggia un'arma così il combattente ha attacchi disponibili
  const withWeapon = addItem(res.character, {
    name: 'Spada lunga', kind: 'weapon', quantity: 1, weight: 3, equipped: true, refId: 'longsword', magic: false, attuned: false,
  });
  return withWeapon.character;
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

  it('account: ping, register/login, salva scheda in libreria e usala in campagna', async () => {
    const c = await connect();
    c.send({ t: 'ping', id: 'p1' });
    const pong = await c.waitFor((m) => m.t === 'pong' && m.id === 'p1');
    expect(typeof pong.serverTime).toBe('number');

    c.send({ t: 'register', username: 'tecmat' });
    let auth = await c.waitFor((m) => m.t === 'auth');
    expect(auth.username).toBe('tecmat');
    expect(auth.characters).toEqual([]);
    expect(auth.token).toBeTruthy();

    // username duplicato (case-insensitive) -> errore
    const dup = await connect();
    dup.send({ t: 'register', username: 'TECMAT' });
    const err = await dup.waitFor((m) => m.t === 'error');
    expect(err.message).toContain('registrato');
    dup.ws.close();

    // login da un'altra connessione: la password non viene mai inviata al server
    const c2 = await connect();
    c2.send({ t: 'login', username: 'tecmat' });
    auth = await c2.waitFor((m) => m.t === 'auth');
    expect(auth.token).toBeTruthy();

    // salva una scheda nella libreria dell'account (senza essere in campagna)
    const ch = makeChar('Biblioteca-Mago', 'wizard');
    c2.send({ t: 'action', action: { kind: 'saveCharacter', character: ch } });
    auth = await c2.waitFor((m) => m.t === 'auth' && m.characters.length === 1);
    expect(auth.characters[0].name).toBe('Biblioteca-Mago');

    // entra in una campagna e carica la scheda dalla libreria dell'account
    const master = await connect();
    master.send({ t: 'create', name: 'DM', password: 'x', campaignName: 'Campagna account' });
    const w = await master.waitFor((m) => m.t === 'welcome');
    const cid: string = w.campaign.id;
    c2.send({ t: 'join', campaignId: cid, password: 'x', name: 'PG' });
    await c2.waitFor((m) => m.t === 'welcome');
    c2.send({ t: 'action', action: { kind: 'useCharacter', characterId: ch.id } });
    const st = await master.waitFor((m) => m.t === 'state' && Object.keys(m.campaign.characters).length === 1);
    const chars = st.campaign.characters as Record<string, Character>;
    expect(Object.values(chars)[0].name).toBe('Biblioteca-Mago');

    // senza login, saveCharacter viene rifiutato
    const anon = await connect();
    anon.send({ t: 'action', action: { kind: 'saveCharacter', character: ch } });
    const err2 = await anon.waitFor((m) => m.t === 'error');
    expect(err2.message).toContain('login');

    c.ws.close();
    c2.ws.close();
    master.ws.close();
    anon.ws.close();
  }, 15000);

  it('rientro come master, pannello master (azioni segrete) e pannello admin', async () => {
    // il master crea la campagna e poi si disconnette: resta senza giocatori
    const m1 = await connect();
    m1.send({ t: 'create', name: 'DM', password: 'pw', campaignName: 'Rientro master' });
    const w1 = await m1.waitFor((m) => m.t === 'welcome');
    const cid: string = w1.campaign.id;
    m1.ws.close();
    await new Promise((r) => setTimeout(r, 200));

    // rientro come master (password corretta, nessun master collegato)
    const m2 = await connect();
    m2.send({ t: 'join', campaignId: cid, password: 'pw', name: 'DM2', role: 'master' });
    const w2 = await m2.waitFor((m) => m.t === 'welcome');
    expect(w2.you.role).toBe('master');

    // un secondo master è rifiutato
    const m3 = await connect();
    m3.send({ t: 'join', campaignId: cid, password: 'pw', name: 'Falso', role: 'master' });
    const e3 = await m3.waitFor((m) => m.t === 'error');
    expect(e3.message).toContain('master');
    m3.ws.close();

    // un player entra e carica la scheda
    const p = await connect();
    p.send({ t: 'join', campaignId: cid, password: 'pw', name: 'PG' });
    const pw2 = await p.waitFor((m) => m.t === 'welcome');
    const pid: string = pw2.you.id;
    expect(pw2.you.role).toBe('player');
    const ch = makeChar('Vittima', 'fighter');
    p.send({ t: 'action', action: { kind: 'setCharacter', character: ch } });
    const st0 = await m2.waitFor((m) => m.t === 'state' && Object.keys(m.campaign.characters).length === 1);
    const hp0: number = st0.campaign.characters[pid].hp.current;
    expect(hp0).toBeGreaterThan(0);

    // il player non può usare le azioni master
    p.send({ t: 'action', action: { kind: 'masterDamage', playerId: pid, amount: 4 } });
    const ep = await p.waitFor((m) => m.t === 'error');
    expect(ep.message).toContain('master');

    // il master applica danni e una condizione "di nascosto" (senza voce nel log)
    m2.send({ t: 'action', action: { kind: 'masterDamage', playerId: pid, amount: 4 } });
    const st1 = await m2.waitFor((m) => m.t === 'state' && m.campaign.characters[pid]?.hp.current === hp0 - 4);
    expect(st1.campaign.combat).toBeNull();
    m2.send({ t: 'action', action: { kind: 'masterSetCondition', playerId: pid, conditionId: 'prone', on: true } });
    await m2.waitFor((m) => m.t === 'state' && m.campaign.characters[pid]?.conditions.includes('prone'));
    m2.send({ t: 'action', action: { kind: 'masterAddXp', playerId: pid, amount: 300 } });
    await m2.waitFor((m) => m.t === 'state' && m.campaign.characters[pid]?.xp === 300);

    // --- pannello admin ---
    const adm = await connect();
    adm.send({ t: 'adminAuth', token: 'sbagliato' });
    const ea = await adm.waitFor((m) => m.t === 'error');
    expect(ea.message).toContain('Token admin');
    adm.send({ t: 'adminAuth', token: 'test-admin-token' });
    const as1 = await adm.waitFor((m) => m.t === 'adminState');
    expect(as1.campaigns.some((c: any) => c.id === cid)).toBe(true);

    adm.send({ t: 'register', username: 'da-eliminare' });
    await adm.waitFor((m) => m.t === 'auth');
    adm.send({ t: 'adminList' });
    await adm.waitFor((m) => m.t === 'adminState' && m.accounts.some((a: any) => a.username === 'da-eliminare'));
    adm.send({ t: 'adminDeleteAccount', username: 'da-eliminare' });
    await adm.waitFor((m) => m.t === 'adminState' && !m.accounts.some((a: any) => a.username === 'da-eliminare'));
    adm.send({ t: 'adminDeleteCampaign', id: cid });
    const as3 = await adm.waitFor((m) => m.t === 'adminState' && !m.campaigns.some((c: any) => c.id === cid));
    expect(as3.campaigns.some((c: any) => c.id === cid)).toBe(false);

    m2.ws.close();
    p.ws.close();
    adm.ws.close();
  }, 15000);
});
