import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { inflateRawSync } from 'node:zlib';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { registrationMode } from './accounts.js';

/**
 * Endpoint di check-update lato server (utile quando il repo GitHub è PRIVATO):
 *   GET /api/update            -> JSON { tag, pageUrl, assets: [{name, url, id}] } dell'ultima release
 *   GET /api/update/asset?name=<file> -> proxy dello descarga dell'asset (con token, se configurato)
 *
 * Configurazione via env:
 *   GITHUB_TOKEN   token (PAT fine-grained con accesso in lettura al repo) — serve per repo privati
 *   DND5E_GH_REPO  default Tecmat/5emanager
 *   DND5E_GH_API   default https://api.github.com (override per test)
 *
 * La web app servita da questo server chiama /api/update sulla stessa origin: nessun token nel client.
 * L'APK Android può scaricare via /api/update/asset?name=app.apk (il browser non ha il token).
 */

const GH_API = (process.env.DND5E_GH_API ?? 'https://api.github.com').replace(/\/$/, '');
const GH_REPO = process.env.DND5E_GH_REPO ?? 'Tecmat/5emanager';
const TOKEN = process.env.GITHUB_TOKEN ?? '';
const ADMIN_TOKEN = process.env.DND5E_ADMIN_TOKEN ?? '';
const STATIC_DIR = process.env.DND5E_STATIC_DIR ?? join(process.cwd(), 'apps', 'web', 'dist');
const CACHE_TTL_MS = 5 * 60_000;

export interface ReleaseAssetInfo { name: string; url: string; id: number }
export interface ReleaseInfo { tag: string; pageUrl: string; assets: ReleaseAssetInfo[] }

let cache: { at: number; data: ReleaseInfo } | null = null;

function ghHeaders(accept: string): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, 'User-Agent': '5emanager-server' };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function ghFetch(path: string, accept: string): Promise<Response> {
  const r = await fetch(`${GH_API}${path}`, { headers: ghHeaders(accept), redirect: 'follow' });
  return r;
}

/** ultima release GitHub (con cache 5 min per non martellare l'API) */
export async function latestRelease(): Promise<ReleaseInfo> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  const r = await ghFetch(`/repos/${GH_REPO}/releases/latest`, 'application/vnd.github+json');
  if (!r.ok) {
    const hint = r.status === 404 || r.status === 401 ? ' (repo privato senza GITHUB_TOKEN, o release inesistente — vedi docs/UPDATE.md)' : '';
    throw new Error(`GitHub API HTTP ${r.status}${hint}`);
  }
  const j = (await r.json()) as any;
  const data: ReleaseInfo = {
    tag: String(j.tag_name ?? ''),
    pageUrl: String(j.html_url ?? `https://github.com/${GH_REPO}/releases`),
    assets: (j.assets ?? []).map((a: any) => ({
      name: String(a.name ?? ''),
      url: String(a.browser_download_url ?? ''),
      id: Number(a.id ?? 0),
    })),
  };
  cache = { at: Date.now(), data };
  return data;
}

/** scarica un asset della release via API (con token) e lo pusha sul response come attachment */
async function proxyAsset(name: string, res: ServerResponse): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'nome asset non valido' }));
    return;
  }
  const rel = await latestRelease();
  const asset = rel.assets.find((a) => a.name === name);
  if (!asset) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Asset "${name}" non trovato nella release ${rel.tag}` }));
    return;
  }
  const r = await ghFetch(`/repos/${GH_REPO}/releases/assets/${asset.id}`, 'application/octet-stream');
  if (!r.ok || !r.body) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Download asset fallito: HTTP ${r.status}` }));
    return;
  }
  res.writeHead(200, {
    'content-type': r.headers.get('content-type') ?? 'application/octet-stream',
    'content-disposition': `attachment; filename="${name}"`,
    ...(r.headers.get('content-length') ? { 'content-length': r.headers.get('content-length')! } : {}),
    'cache-control': 'no-store',
  });
  Readable.fromWeb(r.body as import('node:stream/web').ReadableStream).pipe(res);
}

/**
 * sposta una directory src -> dst. Su overlayfs (immagini Docker) il rename di una directory che
 * vive nei layer inferiori dell'immagine fallisce con EXDEV ("cross-device link not permitted"):
 * in quel caso si fa copia ricorsiva + rimozione (il backup di dist/ deve funzionare sempre).
 */
export function moveDir(src: string, dst: string, renameFn: typeof renameSync = renameSync): void {
  try {
    renameFn(src, dst);
    return;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw e;
  }
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  rmSync(src, { recursive: true, force: true });
}

/** unzip minimale (entry stored + deflate), con guard contro path traversal */
export function unzipTo(buf: Buffer, destDir: string): void {
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD non trovato (non è uno zip?)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const destAbs = join(destDir, '/');
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    off += 46 + nameLen + extraLen + commentLen;
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataOff, dataOff + compSize);
    const outPath = join(destDir, name);
    if (!outPath.startsWith(destAbs)) continue; // path traversal
    if (name.endsWith('/')) {
      mkdirSync(outPath, { recursive: true });
    } else {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, method === 8 ? inflateRawSync(data) : data);
    }
  }
}

/**
 * POST /api/update/apply — aggiorna la web app servita da QUESTO server scaricando
 * web-dist.zip dall'ultima release GitHub (con backup di dist/ e ripristino in caso di errore).
 * Se DND5E_ADMIN_TOKEN è impostato, richiede l'header x-admin-token (o ?token=).
 * Così la webapp si aggiorna tutta dall'app, senza comandi da terminale.
 */
export async function handleApplyUpdate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const json = (code: number, obj: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'POST') return void json(405, { error: 'usa POST' });
  if (ADMIN_TOKEN) {
    const tok = String(req.headers['x-admin-token'] ?? url.searchParams.get('token') ?? '');
    if (tok !== ADMIN_TOKEN) return void json(401, { error: 'token admin richiesto (x-admin-token)' });
  }
  try {
    const rel = await latestRelease();
    const asset = rel.assets.find((a) => a.name === 'web-dist.zip');
    if (!asset) return void json(404, { error: `web-dist.zip non presente nella release ${rel.tag}` });
    const r = await ghFetch(`/repos/${GH_REPO}/releases/assets/${asset.id}`, 'application/octet-stream');
    if (!r.ok || !r.body) return void json(502, { error: `download web-dist.zip: HTTP ${r.status}` });
    const buf = Buffer.from(await r.arrayBuffer());
    const bak = STATIC_DIR + '.bak';
    if (existsSync(STATIC_DIR)) {
      rmSync(bak, { recursive: true, force: true });
      moveDir(STATIC_DIR, bak); // EXDEV-safe: su Docker overlayfs copia invece di rename
    }
    try {
      mkdirSync(STATIC_DIR, { recursive: true });
      unzipTo(buf, STATIC_DIR);
      if (!existsSync(join(STATIC_DIR, 'index.html'))) throw new Error('lo zip non contiene index.html');
    } catch (e) {
      rmSync(STATIC_DIR, { recursive: true, force: true });
      if (existsSync(bak)) moveDir(bak, STATIC_DIR); // ripristina la vecchia build
      throw e;
    }
    return void json(200, { ok: true, version: rel.tag });
  } catch (e) {
    return void json(502, { error: (e as Error).message });
  }
}

/**
 * GET /api/info — identità del server (usata dalla scansione LAN automatica:
 * le app sondano la sottorete e riconoscono i server 5emanager da qui)
 */
export function handleInfoApi(port: number, lan: string[]): (req: IncomingMessage, res: ServerResponse) => boolean {
  return (req, res) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/api/info') return false;
    if (req.method !== 'GET') return false;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    let registration = 'approval';
    try { registration = registrationMode(); } catch { /* noop */ }
    res.end(
      JSON.stringify({
        app: '5emanager',
        name: hostname(),
        version: readFileSync(join(process.cwd(), 'package.json'), 'utf8') ? JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version : '',
        port,
        lan,
        requireAuth: (process.env.DND5E_REQUIRE_AUTH ?? '').trim().toLowerCase() === 'true',
        registration,
      }),
    );
    return true;
  };
}

/**
 * gestisce /api/update e /api/update/asset — ritorna true se la richiesta è stata servita.
 * Va chiamato prima del serving statico.
 */
export async function handleUpdateApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  if (path === '/api/update/apply') {
    await handleApplyUpdate(req, res);
    return true;
  }
  if (path === '/api/update') {
    try {
      const rel = await latestRelease();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(rel));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
    return true;
  }
  if (path === '/api/update/asset') {
    try {
      await proxyAsset(url.searchParams.get('name') ?? '', res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
    return true;
  }
  return false;
}
