import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createFirstAdmin, setupRequired } from './accounts.js';
import { audit } from './audit.js';

export const SETUP_PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'setup.html');

/**
 * Setup iniziale del server (prima configurazione):
 *   GET  /api/setup          -> { setupRequired, tokenRequired }   (la pagina /setup lo usa)
 *   POST /api/setup          -> crea il PRIMO account (sempre admin); permitido solo se non
 *                               esistono ancora account. Se DND5E_ADMIN_TOKEN e' impostato
 *                               (in Docker lo genera l'entrypoint), serve l'header x-admin-token.
 * Evita che su un server fresco esposto su Internet chiunque crei il primo admin prima del owner.
 */
export async function handleSetupApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/api/setup') return false;
  const json = (code: number, obj: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const adminToken = process.env.DND5E_ADMIN_TOKEN ?? '';
  const tokenRequired = adminToken !== '';
  if (req.method === 'GET') {
    return void json(200, { setupRequired: setupRequired(), tokenRequired }), true;
  }
  if (req.method !== 'POST') return void json(405, { error: 'usa POST' }), true;
  if (tokenRequired) {
    const tok = String(req.headers['x-admin-token'] ?? url.searchParams.get('token') ?? '');
    if (tok !== adminToken) return void json(401, { error: 'token admin richiesto (x-admin-token): e quello generato da Docker nei log / in admin-token.txt' }), true;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024) return void json(413, { error: 'body troppo grande' }), true;
      chunks.push(c as Buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const acc = createFirstAdmin(String(body.username ?? ''), String(body.password ?? ''));
    audit('setup', 'first-admin', acc.username, String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''));
    return void json(200, { ok: true, username: acc.username, role: 'admin' as const, next: '/admin' }), true;
  } catch (e) {
    const msg = (e as Error).message;
    const code = /gia completato/.test(msg) ? 403 : 400;
    return void json(code, { error: msg }), true;
  }
}

/** serve la pagina /setup (setup.html) — chiamata da serveStatic */
export function serveSetupPage(res: ServerResponse): boolean {
  if (!existsSync(SETUP_PAGE)) return false;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(readFileSync(SETUP_PAGE));
  return true;
}
