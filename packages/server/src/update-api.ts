import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

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
 * L'APK Android può scaricare via /api/update/asset?name=app-debug.apk (il browser non ha il token).
 */

const GH_API = (process.env.DND5E_GH_API ?? 'https://api.github.com').replace(/\/$/, '');
const GH_REPO = process.env.DND5E_GH_REPO ?? 'Tecmat/5emanager';
const TOKEN = process.env.GITHUB_TOKEN ?? '';
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
 * gestisce /api/update e /api/update/asset — ritorna true se la richiesta è stata servita.
 * Va chiamato prima del serving statico.
 */
export async function handleUpdateApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
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
