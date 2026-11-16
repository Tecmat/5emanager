import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createRegistry, loadData, type Registry } from '@dnd5e/core';
import { SRD_DATA } from '@dnd5e/data-srd';
import type { Campaign, ClientMessage, PlayerInfo, ServerMessage } from './protocol.js';
import {
  addCustom,
  addPlayer,
  checkPassword,
  createCampaign,
  ensureDataDir,
  listCampaigns,
  loadCampaign,
  removePlayer,
  saveCampaign,
} from './campaign.js';
import { applyAction } from './combat-ops.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATIC_DIR = process.env.DND5E_STATIC_DIR ?? join(process.cwd(), 'apps', 'web', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(STATIC_DIR)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Web app non ancora buildata: esegui `npm run build -w @dnd5e/web`');
    return;
  }
  let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (path === '/') path = '/index.html';
  const file = normalize(join(STATIC_DIR, path));
  if (!file.startsWith(normalize(STATIC_DIR)) || !existsSync(file) || !statSync(file).isFile()) {
    // fallback SPA
    const index = join(STATIC_DIR, 'index.html');
    if (existsSync(index)) {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(readFileSync(index));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

/** registry della campagna: SRD + custom del campaign */
function campaignRegistry(c: Campaign): Registry {
  const reg = createRegistry();
  loadData(reg, SRD_DATA);
  if (c.custom && Object.keys(c.custom).length > 0) loadData(reg, c.custom as never);
  return reg;
}

interface Conn {
  ws: WebSocket;
  campaignId?: string;
  playerId?: string;
}

const conns = new Set<Conn>();
const campaigns = new Map<string, Campaign>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(campaign: Campaign): void {
  const msg: ServerMessage = { t: 'state', campaign };
  for (const c of conns) {
    if (c.campaignId === campaign.id) send(c.ws, msg);
  }
}

function handleMessage(conn: Conn, raw: string): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.t === 'list') {
    send(conn.ws, { t: 'campaigns', list: listCampaigns() });
    return;
  }

  if (msg.t === 'create') {
    const player: PlayerInfo = { id: randomUUID(), name: msg.name, role: 'master' };
    const c = createCampaign(msg.campaignName, msg.password, player);
    campaigns.set(c.id, c);
    conn.campaignId = c.id;
    conn.playerId = player.id;
    conns.add(conn);
    send(conn.ws, { t: 'welcome', you: player, campaign: c });
    return;
  }

  if (msg.t === 'join') {
    const c = campaigns.get(msg.campaignId) ?? loadCampaign(msg.campaignId);
    if (!c) {
      send(conn.ws, { t: 'error', message: 'Campagna non trovata: ' + msg.campaignId });
      return;
    }
    if (!checkPassword(c, msg.password)) {
      send(conn.ws, { t: 'error', message: 'Password sbagliata' });
      return;
    }
    campaigns.set(c.id, c);
    const player: PlayerInfo = { id: randomUUID(), name: msg.name, role: msg.role === 'master' ? 'player' : 'player' };
    addPlayer(c, player);
    conn.campaignId = c.id;
    conn.playerId = player.id;
    conns.add(conn);
    send(conn.ws, { t: 'welcome', you: player, campaign: c });
    broadcast(c);
    return;
  }

  if (msg.t === 'action' && conn.campaignId && conn.playerId) {
    let c = campaigns.get(conn.campaignId);
    if (!c) {
      send(conn.ws, { t: 'error', message: 'Campagna non caricata' });
      return;
    }
    if (msg.action.kind === 'addCustom') {
      const player = c.players.find((p) => p.id === conn.playerId);
      if (player?.role !== 'master') {
        send(conn.ws, { t: 'error', message: 'Solo il master può aggiungere contenuti custom' });
        return;
      }
      addCustom(c, msg.action.data);
      saveCampaign(c);
      broadcast(c);
      return;
    }
    if (msg.action.kind === 'leave') {
      c = removePlayer(c, conn.playerId);
      campaigns.set(c.id, c);
      conn.campaignId = undefined;
      conn.playerId = undefined;
      broadcast(c);
      return;
    }
    const reg = campaignRegistry(c);
    const [next, err] = applyAction(c, conn.playerId, reg, msg.action);
    if (err) {
      send(conn.ws, { t: 'error', message: err });
      return;
    }
    campaigns.set(next.id, next);
    broadcast(next);
  }
}

export function createDndServer(port = PORT, host = HOST) {
  ensureDataDir();
  const http = createServer(serveStatic);
  const wss = new WebSocketServer({ server: http, maxPayload: 4 * 1024 * 1024 });

  wss.on('connection', (ws) => {
    const conn: Conn = { ws };
    conns.add(conn);
    ws.on('message', (data) => {
      try {
        handleMessage(conn, data.toString());
      } catch (e) {
        send(ws, { t: 'error', message: 'Errore interno: ' + (e as Error).message });
      }
    });
    ws.on('close', () => {
      conns.delete(conn);
      if (conn.campaignId && conn.playerId) {
        const c = campaigns.get(conn.campaignId);
        if (c) {
          const next = removePlayer(c, conn.playerId);
          campaigns.set(next.id, next);
          broadcast(next);
        }
      }
    });
  });

  return new Promise<{ http: typeof http; wss: WebSocketServer; port: number }>((resolve) => {
    http.listen(port, host, () => {
      const address = http.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({ http, wss, port: actualPort });
    });
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '');
if (process.argv[1]?.includes('server/src/index')) {
  createDndServer().then(({ port }) => {
    console.log(`🎲 5e Manager server in ascolto su http://${HOST}:${port}`);
    console.log(`   Web app: http://<host>:${port}/  (build: npm run build -w @dnd5e/web)`);
    console.log(`   WebSocket: ws://<host>:${port}`);
  });
}
