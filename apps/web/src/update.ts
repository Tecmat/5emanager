import { Capacitor } from '@capacitor/core';
import { isNewerVersion, parseAssetUrlsFromExpandedAssets, parseLatestTagFromAtom } from '@dnd5e/core';

/**
 * Check-update in-app, per piattaforma. Il repo GitHub può essere PRIVATO: in quel caso
 * l'API pubblica risponde 404 e si usa il proxy del server self-hosted (/api/update, che
 * usa GITHUB_TOKEN lato server) oppure, sul desktop, un token locale (env GITHUB_TOKEN,
 * ~/.config/emanager/github-token o `gh auth token`).
 *
 * Ordine dei tentativi (web/android):
 *   1. /api/update del server 5emanager (same-origin in web, URL salvato in Android)
 *   2. API GitHub pubblica (funziona solo se il repo è pubblico)
 *   3. fallback HTML github.com (atom + expanded_assets, solo repo pubblico)
 * Desktop (Tauri): il check lo fa il processo Rust via comando `check_update`.
 */

export const REPO = 'Tecmat/5emanager';
export type Platform = 'web' | 'desktop' | 'android';

/** Tauri rigetta le Err(String) dei comandi come stringa semplice, non come Error: normalizza */
export function errMsg(e: unknown): string {
  if (typeof e === 'string') return e;
  const m = (e as Error | undefined)?.message;
  return m ?? String(e);
}

export interface UpdateInfo {
  platform: Platform;
  current: string;
  latest: string;
  available: boolean;
  pageUrl: string;
  assetUrl?: string;
  assetName?: string;
  checkedAt: string;
  via: 'server' | 'api' | 'html' | 'tauri';
}

export function detectPlatform(): Platform {
  if (Capacitor.isNativePlatform()) return Capacitor.getPlatform() === 'android' ? 'android' : 'web';
  return (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ? 'desktop' : 'web';
}

/** versione della build corrente (dal version.json servito con l'app) */
export async function getCurrentVersion(): Promise<string> {
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    if (r.ok) return ((await r.json()).version as string) ?? '0.0.0';
  } catch { /* offline */ }
  return '0.0.0';
}

async function fetchWithTimeout(url: string, ms = 9000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json, application/json' } });
  } finally {
    clearTimeout(t);
  }
}

/** origin del server 5emanager: same-origin in web, URL salvato (ws://…) in Android */
export function serverOrigin(): string | null {
  if (detectPlatform() === 'web' && /^https?:$/.test(location.protocol)) return location.origin;
  try {
    const saved = localStorage.getItem('dnd5e.net.url') ?? '';
    const m = saved.match(/^(wss?):\/\/([^/]+)/);
    if (m) return `http${m[1] === 'wss' ? 's' : ''}://${m[2]}`;
  } catch { /* ignora */ }
  return null;
}

interface GhAsset { name: string; browser_download_url: string }
interface ReleaseLike { tag: string; pageUrl: string; assets: GhAsset[] }

function pickAsset(assets: GhAsset[], platform: Platform): GhAsset | undefined {
  if (platform === 'android') return assets.find((a) => a.name.endsWith('.apk'));
  if (platform === 'desktop') return assets.find((a) => a.name.endsWith('.AppImage'));
  return undefined;
}

function toUpdateInfo(rel: ReleaseLike, via: UpdateInfo['via'], current: string, assetOverride?: string): UpdateInfo {
  const platform = detectPlatform();
  const latest = rel.tag.replace(/^v/i, '');
  const asset = pickAsset(rel.assets, platform);
  return {
    platform,
    current,
    latest,
    available: isNewerVersion(latest, current),
    pageUrl: rel.pageUrl,
    assetUrl: assetOverride ?? asset?.browser_download_url,
    assetName: asset?.name,
    checkedAt: new Date().toISOString(),
    via,
  };
}

/** 1) proxy del server self-hosted (unico modo con repo privato, senza token nel client) */
async function checkViaServer(): Promise<UpdateInfo> {
  const origin = serverOrigin();
  if (!origin) throw new Error('nessun server configurato');
  const r = await fetchWithTimeout(`${origin}/api/update`);
  if (!r.ok) throw new Error(`/api/update: HTTP ${r.status}`);
  const j = (await r.json()) as { tag: string; pageUrl: string; assets: { name: string; url: string }[] };
  const current = await getCurrentVersion();
  const platform = detectPlatform();
  const assets: GhAsset[] = (j.assets ?? []).map((a) => ({ name: a.name, browser_download_url: a.url }));
  const asset = pickAsset(assets, platform);
  // per Android l'asset si scarica via proxy del server (il browser non ha il token del repo privato)
  const assetUrl = asset ? (platform === 'android' ? `${origin}/api/update/asset?name=${encodeURIComponent(asset.name)}` : asset.browser_download_url) : undefined;
  return toUpdateInfo({ tag: j.tag, pageUrl: j.pageUrl, assets }, 'server', current, assetUrl);
}

/** 2) API GitHub pubblica */
async function checkViaApi(): Promise<UpdateInfo> {
  const r = await fetchWithTimeout(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!r.ok) throw new Error(`api.github.com: HTTP ${r.status}${r.status === 404 ? ' (repo privato? usa il server /api/update o un token)' : ''}`);
  const j = (await r.json()) as { tag_name: string; html_url: string; assets: GhAsset[] };
  return toUpdateInfo({ tag: j.tag_name, pageUrl: j.html_url, assets: j.assets ?? [] }, 'api', await getCurrentVersion());
}

/** 3) fallback HTML github.com (atom + expanded_assets) — solo repo pubblico, senza rate limit */
async function checkViaHtml(): Promise<UpdateInfo> {
  const atom = await (await fetchWithTimeout(`https://github.com/${REPO}/releases.atom`)).text();
  const tag = parseLatestTagFromAtom(atom);
  if (!tag) throw new Error('feed atom senza tag (repo privato senza token?)');
  const assets: GhAsset[] = [];
  try {
    const ea = await fetchWithTimeout(`https://github.com/${REPO}/releases/expanded_assets/${tag}`);
    if (ea.ok) {
      for (const a of parseAssetUrlsFromExpandedAssets(await ea.text(), tag)) assets.push({ name: a.name, browser_download_url: a.url });
    }
  } catch { /* gli asset restano vuoti */ }
  return toUpdateInfo({ tag, pageUrl: `https://github.com/${REPO}/releases/tag/${tag}`, assets }, 'html', await getCurrentVersion());
}

/** check completo web/android: server → API → HTML, con errori dettagliati */
export async function checkUpdateWeb(): Promise<UpdateInfo> {
  const errors: string[] = [];
  for (const attempt of [checkViaServer, checkViaApi, checkViaHtml]) {
    try {
      return await attempt();
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(errors.join(' · '));
}

/** desktop: comando Tauri (Rust con token locale); fallback al flusso web con errori aggregati */
export async function checkUpdate(): Promise<UpdateInfo> {
  if (detectPlatform() === 'desktop') {
    let tauriErr = '';
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return (await invoke('check_update')) as UpdateInfo;
    } catch (e) {
      tauriErr = errMsg(e);
    }
    try {
      return await checkUpdateWeb();
    } catch (e) {
      throw new Error([tauriErr ? `tauri: ${tauriErr}` : '', errMsg(e)].filter(Boolean).join(' · '));
    }
  }
  return checkUpdateWeb();
}

/** web/PWA: true se c'è un service worker nuovo in attesa o il server serve una build più recente */
export async function checkSwUpdate(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
    if (reg?.waiting) return true;
    const remote = (await (await fetch('/version.json', { cache: 'no-store' })).json()) as { version?: string };
    const local = localStorage.getItem('dnd5e.appVersion');
    if (remote.version) localStorage.setItem('dnd5e.appVersion', remote.version);
    return !!local && !!remote.version && local !== remote.version;
  } catch {
    return false;
  }
}

/** web/PWA: applica l'aggiornamento (nuovo SW + reload) */
export async function applyWebUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.waiting?.postMessage('SKIP_WAITING');
    if (reg?.installing) {
      reg.installing.addEventListener('statechange', () => {
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
      });
    }
  } catch { /* ignora */ }
  setTimeout(() => window.location.reload(), 700);
}

/** android: apre il download dell'APK col browser di sistema (poi un tap installa) */
export async function openAndroidDownload(info: UpdateInfo): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: info.assetUrl ?? info.pageUrl, presentationStyle: 'fullscreen' });
}

export interface DownloadProgress { received: number; total: number }

/** desktop: scarica il nuovo AppImage accanto all'eseguibile corrente, con progresso via evento Tauri */
export async function downloadDesktopUpdate(assetUrl: string, onProgress: (p: DownloadProgress) => void): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const un = await listen<DownloadProgress>('update-progress', (e) => onProgress(e.payload));
  try {
    await invoke('download_update', { url: assetUrl });
  } finally {
    un();
  }
}

/** desktop: sostituisce l'AppImage corrente con quello scaricato e riavvia l'app (non ritorna) */
export async function applyDesktopUpdate(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('apply_update');
}
