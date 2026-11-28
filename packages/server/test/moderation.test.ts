import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { applyCampaignAction, isPlayerBlocked, DEFAULT_HOUSE_RULES, DEFAULT_STATS, type Campaign } from '@dnd5e/core';
import { createSrdRegistry } from '@dnd5e/data-srd';

/**
 * Moderazione server-side + validazione immagini (ritratto PG):
 *  - media.sanitizePortrait: solo data URL png/jpeg/webp/gif, base64 pulito, magic bytes
 *    coerenti, byte <= DND5E_MAX_PORTRAIT_BYTES (1 MiB) e dimensioni <= DND5E_MAX_IMAGE_DIM (4096)
 *  - moderation.ts: log JSONL attivabile/disattivabile con DND5E_MODERATION_LOG
 *  - core: blockPlayer/unblockPlayer/reportPlayer + isPlayerBlocked
 *  - integrazione WS: il master blocca un giocatore -> espulso e join rifiutato; il ritratto
 *    non valido viene stroncato lato server e auditato
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-moderation-'));
delete process.env.DND5E_MODERATION_LOG; // default: attivo

let server: Awaited<ReturnType<typeof import('../src/index.js').createDndServer>>;
let port: number;
let media: typeof import('../src/media.js');
let moderation: typeof import('../src/moderation.js');

beforeAll(async () => {
  media = await import('../src/media.js');
  moderation = await import('../src/moderation.js');
  const mod = await import('../src/index.js');
  server = await mod.createDndServer(0, '127.0.0.1');
  port = server.port;
});

afterAll(async () => {
  for (const client of server.wss.clients) client.terminate();
  server.wss.close();
  await new Promise((r) => server.http.close(r));
}, 20000);

// ---- helper immagini minime ma con header veri ----
function pngBuf(w: number, h: number, pad = 0): Buffer {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function jpegBuf(w: number, h: number): Buffer {
  const b = Buffer.alloc(20);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xc0;
  b.writeUInt16BE(11, 4); // longueur segmento SOF0
  b[6] = 8; // precisione
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
}
function gifBuf(w: number, h: number): Buffer {
  const b = Buffer.alloc(10);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}
function webpVp8xBuf(w: number, h: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}
function dataUrl(mime: string, buf: Buffer): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

describe('sanitizePortrait (media.ts)', () => {
  it('accetta png/jpeg/gif/webp validi entro i limiti', () => {
    expect(media.sanitizePortrait(dataUrl('image/png', pngBuf(512, 512)))).toBe(dataUrl('image/png', pngBuf(512, 512)));
    expect(media.sanitizePortrait(dataUrl('image/jpeg', jpegBuf(300, 200)))).toBe(dataUrl('image/jpeg', jpegBuf(300, 200)));
    expect(media.sanitizePortrait(dataUrl('image/gif', gifBuf(64, 64)))).toBe(dataUrl('image/gif', gifBuf(64, 64)));
    expect(media.sanitizePortrait(dataUrl('image/webp', webpVp8xBuf(400, 300)))).toBe(dataUrl('image/webp', webpVp8xBuf(400, 300)));
  });

  it('rifiuta svg/html/testo/strumenti non-immagine (XSS)', () => {
    expect(media.sanitizePortrait('data:image/svg+xml;base64,PHN2Zy8+')).toBeUndefined();
    expect(media.sanitizePortrait('data:text/html;base64,PGI+')).toBeUndefined();
    expect(media.sanitizePortrait('<img src=x onerror=alert(1)>')).toBeUndefined();
    expect(media.sanitizePortrait('')).toBeUndefined();
    expect(media.sanitizePortrait(undefined)).toBeUndefined();
    expect(media.sanitizePortrait(42)).toBeUndefined();
    expect(media.sanitizePortrait('data:image/png;base64,!!!non-base64!!!')).toBeUndefined();
  });

  it('rifiuta magic bytes non coerenti col mime', () => {
    expect(media.sanitizePortrait(dataUrl('image/png', jpegBuf(10, 10)))).toBeUndefined();
    expect(media.sanitizePortrait(dataUrl('image/jpeg', pngBuf(10, 10)))).toBeUndefined();
  });

  it('rifiuta dimensioni oltre DND5E_MAX_IMAGE_DIM (decompression bomb)', () => {
    expect(media.sanitizePortrait(dataUrl('image/png', pngBuf(5000, 10)))).toBeUndefined();
    expect(media.sanitizePortrait(dataUrl('image/gif', gifBuf(4097, 4097)))).toBeUndefined();
    expect(media.sanitizePortrait(dataUrl('image/webp', webpVp8xBuf(99999, 1)))).toBeUndefined();
  });

  it('rifiuta file oltre DND5E_MAX_PORTRAIT_BYTES (1 MiB)', () => {
    const big = pngBuf(10, 10, 1024 * 1024 + 16); // header valido ma payload enorme
    expect(media.sanitizePortrait(dataUrl('image/png', big))).toBeUndefined();
  });
});

describe('moderation log (moderation.ts)', () => {
  it('attivo di default: scrive e rilegge JSONL', () => {
    expect(moderation.moderationEnabled()).toBe(true);
    moderation.moderationLog('tester', 'report-player', 'campaign=abc target=xyz', '127.0.0.1');
    const entries = moderation.readModerationLog(10);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].action).toBe('report-player');
    expect(entries[0].actor).toBe('tester');
  });

  it('disattivabile con DND5E_MODERATION_LOG=0 (nessuna scrittura)', () => {
    process.env.DND5E_MODERATION_LOG = '0';
    expect(moderation.moderationEnabled()).toBe(false);
    const before = moderation.readModerationLog(500).length;
    moderation.moderationLog('tester', 'no-write', 'x');
    expect(moderation.readModerationLog(500).length).toBe(before);
    delete process.env.DND5E_MODERATION_LOG;
    expect(moderation.moderationEnabled()).toBe(true);
  });
});

describe('blockPlayer/unblockPlayer/reportPlayer (core)', () => {
  const reg = createSrdRegistry();
  function makeCampaign(): Campaign {
    return {
      id: 'camp1', name: 'Test', passwordHash: 'x',
      houseRules: { ...DEFAULT_HOUSE_RULES }, custom: {},
      players: [
        { id: 'm1', name: 'Master', role: 'master', online: true, username: 'root' },
        { id: 'p1', name: 'Bob', role: 'player', online: true, username: 'bob' },
      ],
      characters: { p1: { id: 'c1' } as never },
      combat: null, groupInventory: [], groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      notes: '', chat: [], stats: { ...DEFAULT_STATS }, blockedPlayers: [],
      createdAt: '', updatedAt: '',
    };
  }

  it('solo il master blocca; il target viene rimosso e messo in blocklist', () => {
    const c = makeCampaign();
    const [next, err] = applyCampaignAction(c, 'p1', reg, { kind: 'blockPlayer', playerId: 'p1' });
    expect(err).toBe('Solo il master può bloccare un giocatore');
    const [ok, err2] = applyCampaignAction(c, 'm1', reg, { kind: 'blockPlayer', playerId: 'p1', reason: 'griefing' });
    expect(err2).toBeUndefined();
    expect(ok.players.some((p) => p.id === 'p1')).toBe(false);
    expect(ok.characters['p1']).toBeUndefined();
    expect(ok.blockedPlayers?.length).toBe(1);
    expect(ok.blockedPlayers?.[0]).toMatchObject({ id: 'p1', name: 'Bob', username: 'bob', reason: 'griefing' });
    // niente auto-blocco
    const [, errSelf] = applyCampaignAction(c, 'm1', reg, { kind: 'blockPlayer', playerId: 'm1' });
    expect(errSelf).toContain('te stesso');
  });

  it('isPlayerBlocked: per id, username e nome (anonimo)', () => {
    const c = makeCampaign();
    const [blocked] = applyCampaignAction(c, 'm1', reg, { kind: 'blockPlayer', playerId: 'p1' });
    expect(isPlayerBlocked(blocked, { playerId: 'p1' })?.name).toBe('Bob');
    expect(isPlayerBlocked(blocked, { username: 'BOB' })?.id).toBe('p1');
    expect(isPlayerBlocked(blocked, { name: ' bob ' })?.id).toBe('p1'); // anonimo: match sul nome
    expect(isPlayerBlocked(blocked, { username: 'alice', name: 'bob' })).toBeUndefined(); // loggato: niente fallback sul nome
    const c2 = { ...blocked, blockedPlayers: [{ id: 'x', name: 'Anon', at: '' }] };
    expect(isPlayerBlocked(c2, { name: 'anon' })?.id).toBe('x');
    const [unblocked] = applyCampaignAction(c, 'm1', reg, { kind: 'unblockPlayer', playerId: 'p1' });
    expect(unblocked.blockedPlayers?.length).toBe(0);
  });

  it('reportPlayer: validazione senza cambio di stato', () => {
    const c = makeCampaign();
    const [next, err] = applyCampaignAction(c, 'p1', reg, { kind: 'reportPlayer', playerId: 'm1', reason: 'spam' });
    expect(err).toBeUndefined();
    expect(next.players.length).toBe(2);
    const [, errSelf] = applyCampaignAction(c, 'p1', reg, { kind: 'reportPlayer', playerId: 'p1' });
    expect(errSelf).toContain('te stesso');
  });
});

// ---- integrazione WS ----
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
        if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
      }
    });
    ws.on('open', () => {
      resolve({
        ws, messages,
        send: (m) => ws.send(JSON.stringify(m)),
        waitFor: (pred, timeoutMs = 3000) => new Promise((res, rej) => {
          const found = messages.find(pred);
          if (found) return res(found);
          const w = { pred, resolve: res };
          waiters.push(w);
          setTimeout(() => {
            const i = waiters.indexOf(w);
            if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout in attesa del messaggio')); }
          }, timeoutMs);
        }),
      });
    });
  });
}

describe('integrazione WS: block + portrait sanificato', () => {
  it('il master blocca un giocatore: espulso, join successivo rifiutato, eventi nel moderation log', async () => {
    const master = await connect();
    master.send({ t: 'create', name: 'Master', password: 'pw', campaignName: 'Camp' });
    const welcome = await master.waitFor((m) => m.t === 'welcome');
    const campaignId = welcome.campaign.id;
    const masterId = welcome.you.id;

    const bob = await connect();
    bob.send({ t: 'join', campaignId, password: 'pw', name: 'Bob', role: 'player' });
    const bobWelcome = await bob.waitFor((m) => m.t === 'welcome');
    const bobId = bobWelcome.you.id;

    // Bob carica una scheda con ritratto SVG (non ammesso): il server lo stronca
    bob.send({ t: 'action', action: { kind: 'setCharacter', character: { id: 'c1', name: 'Bob PG', portrait: 'data:image/svg+xml;base64,PHN2Zy8+' } } });
    const state = await master.waitFor((m) => m.t === 'state' && m.campaign.characters[bobId]);
    expect(state.campaign.characters[bobId].portrait).toBeUndefined();

    // il master blocca Bob
    master.send({ t: 'action', action: { kind: 'blockPlayer', playerId: bobId, reason: 'griefing' } });
    await master.waitFor((m) => m.t === 'state' && !m.campaign.players.some((p: any) => p.id === bobId));
    await bob.waitFor((m) => m.t === 'kicked');

    // Bob riprova a entrare (stessa password e nome): rifiutato
    const bob2 = await connect();
    bob2.send({ t: 'join', campaignId, password: 'pw', name: 'Bob', role: 'player' });
    const err = await bob2.waitFor((m) => m.t === 'error');
    expect(err.message).toContain('bloccato');

    // moderation log: block-player + blocked-join-attempt + portrait-sanitized
    const entries = moderation.readModerationLog(50).map((e) => e.action);
    expect(entries).toContain('block-player');
    expect(entries).toContain('blocked-join-attempt');
    expect(entries).toContain('portrait-sanitized');
    // audit log: portrait-sanitized
    const auditMod = await import('../src/audit.js');
    expect(auditMod.readAudit(50).map((e) => e.action)).toContain('portrait-sanitized');

    // sblocco: Bob puo' rientrare
    master.send({ t: 'action', action: { kind: 'unblockPlayer', playerId: bobId } });
    await master.waitFor((m) => m.t === 'state' && (m.campaign.blockedPlayers ?? []).length === 0);
    const bob3 = await connect();
    bob3.send({ t: 'join', campaignId, password: 'pw', name: 'Bob', role: 'player' });
    const ok = await bob3.waitFor((m) => m.t === 'welcome' || m.t === 'error');
    expect(ok.t).toBe('welcome');

    master.ws.close(); bob.ws.close(); bob2.ws.close(); bob3.ws.close();
    void masterId;
  });

  it('il file moderation.log esiste su disco in DND5E_DATA_DIR', () => {
    const f = join(process.env.DND5E_DATA_DIR as string, 'moderation.log');
    expect(existsSync(f)).toBe(true);
    const line = readFileSync(f, 'utf8').trim().split('\n').pop() ?? '';
    expect(JSON.parse(line).action).toBeTruthy();
  });
});
