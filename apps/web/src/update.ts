import { Capacitor, registerPlugin } from '@capacitor/core';
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

// iniettata da vite (define) con la versione del package.json della webapp
declare const __APP_VERSION__: string;

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

/** versione della build corrente: prima /version.json servito con l'app, poi la versione compilata nel bundle (mai più 0.0.0) */
export async function getCurrentVersion(): Promise<string> {
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    if (r.ok) {
      const v = (await r.json()).version as string;
      if (v && v !== '0.0.0') return v;
    }
  } catch { /* offline */ }
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
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

/** 1) proxy del server self-hosted (unico modo con repo privato, senza token nel client).
 * Su Android, se non c'è un URL salvato, prova a trovare un server 5emanager sulla LAN (scansione). */
async function checkViaServer(): Promise<UpdateInfo> {
  let origin = serverOrigin();
  if (!origin && detectPlatform() === 'android') {
    try {
      const { scanLanPeers } = await import('./lan.js');
      const peers = await scanLanPeers();
      const srv = peers.find((p) => p.kind === 'server');
      if (srv) {
        origin = `http://${srv.ip}:${srv.port}`;
        try { localStorage.setItem('dnd5e.net.url', `ws://${srv.ip}:${srv.port}`); } catch { /* quota */ }
      }
    } catch { /* scansione non riuscita: si passa agli altri metodi */ }
  }
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

/** 2b) fallback jsDelivr (CORS *): la versione di main == ultima release (bump a ogni release).
 * L'asset viene poi scaricato DIRETTO da GitHub (plugin/Rust, niente CORS). */
async function checkViaJsdelivr(): Promise<UpdateInfo> {
  const r = await fetchWithTimeout(`https://cdn.jsdelivr.net/gh/${REPO}@main/package.json`);
  if (!r.ok) throw new Error(`cdn.jsdelivr.net: HTTP ${r.status}`);
  const j = (await r.json()) as { version?: string };
  const latest = String(j.version ?? '').replace(/^v/i, '');
  if (!latest) throw new Error('jsdelivr: version mancante');
  const platform = detectPlatform();
  // asset come pubblicato dal workflow release.yml: l'APK si chiama app.apk (non app-debug.apk)
  const assetName = platform === 'android' ? 'app.apk' : platform === 'desktop' ? `5e.Manager_${latest}_amd64.AppImage` : undefined;
  const current = await getCurrentVersion();
  return {
    platform,
    current,
    latest,
    available: isNewerVersion(latest, current),
    pageUrl: `https://github.com/${REPO}/releases/tag/v${latest}`,
    assetUrl: assetName ? `https://github.com/${REPO}/releases/download/v${latest}/${assetName}` : undefined,
    assetName,
    checkedAt: new Date().toISOString(),
    via: 'html',
  };
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
  for (const attempt of [checkViaServer, checkViaApi, checkViaJsdelivr, checkViaHtml]) {
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

/** web/PWA: applica l'aggiornamento (forza il check del SW, skipWaiting, poi reload) */
export async function applyWebUpdate(): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update(); // scarica subito il nuovo sw.js
        reg.waiting?.postMessage('SKIP_WAITING');
        navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      }
    } catch { /* ignora */ }
  }
  // fallback: reload dopo un attimo (se il nuovo SW è già attivo, carica la build nuova)
  setTimeout(() => window.location.reload(), 1200);
}

/** URL candidats per l'APK di una release: le release fino a v0.1.38 pubblicavano app-debug.apk, poi app.apk */
export function apkDownloadUrls(info: UpdateInfo): string[] {
  const base = `https://github.com/${REPO}/releases/download/v${info.latest}`;
  const urls = [info.assetUrl, `${base}/app.apk`, `${base}/app-debug.apk`].filter((u): u is string => !!u);
  return [...new Set(urls)];
}

interface UpdateInstallerPlugin {
  downloadAndInstall(opts: { url: string }): Promise<void>;
  addListener(eventName: 'update-progress' | 'needsInstallPermission', cb: (p: any) => void): Promise<{ remove: () => Promise<void> }>;
}
// plugin nativo custom (patchato in CI in apps/web/android-overlay)
const UpdateInstaller = registerPlugin<UpdateInstallerPlugin>('UpdateInstaller');

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tempo scaduto (${Math.round(ms / 1000)}s): riprova`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * android: scarica l'APK e apre SUBITO il prompt di installazione dentro l'app
 * (plugin UpdateInstaller via FileProvider) — NIENTE browser/popup esterni.
 * - prova tutti gli URL candidats (app.apk, app-debug.apk): su HTTP 404 passa al successivo;
 * - se manca il permesso "installa app sconosciute" il plugin apre le impostazioni e resta
 *   in sospeso: onNeedsPermission avvisa subito e un watchdog sblocca l'UI dopo 180 s;
 * - se il plugin manca (build vecchia) ritorna un errore col link diretto, mai un pop-up.
 */
export async function applyAndroidUpdate(info: UpdateInfo, onProgress?: (p: DownloadProgress) => void, onNeedsPermission?: () => void): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  const urls = apkDownloadUrls(info);
  if (urls.length === 0) throw new Error('Nessun URL APK disponibile per la v' + info.latest);
  // nota: NON usare isPluginAvailable come pre-check (falso negativo sui plugin custom senza
  // implementazione web): si prova la chiamata e si interpreta l'errore
  let removeProg: (() => void) | undefined;
  let removePerm: (() => void) | undefined;
  try {
    if (onProgress) {
      try {
        const l = await UpdateInstaller.addListener('update-progress', onProgress);
        removeProg = () => void l.remove();
      } catch { /* listener non supportato: si continua senza progresso */ }
    }
    try {
      const lp = await UpdateInstaller.addListener('needsInstallPermission', () => onNeedsPermission?.());
      removePerm = () => void lp.remove();
    } catch { /* evento non supportato da build vecchie */ }
    let lastErr = '';
    for (const url of urls) {
      try {
        await withTimeout(UpdateInstaller.downloadAndInstall({ url }), 180_000);
        return; // prompt di installazione di Android aperto dentro l'app
      } catch (e) {
        const m = errMsg(e);
        if (/installa app|permesso/i.test(m)) {
          throw new Error('Permesso "Installa app sconosciute" mancante: abilitalo per 5e Manager nelle impostazioni che si sono aperte, poi premi di nuovo "Scarica e installa".');
        }
        if (/not implemented|not available|plugin/i.test(m)) {
          // build vecchia senza plugin nativo: messaggio chiaro + link diretto (no pop-up)
          throw new Error('Auto-installazione non disponibile in questa build (plugin UpdateInstaller mancante): scarica e installa a mano l\'APK da ' + urls[0]);
        }
        lastErr = m;
        if (!/HTTP 404|\b404\b|not found/i.test(m)) throw new Error(m); // rete/permessi: non ha senso ritentare
      }
    }
    throw new Error(lastErr || 'download APK fallito');
  } finally {
    removeProg?.();
    removePerm?.();
  }
}

/**
 * web servita dal server 5emanager: POST /api/update/apply → il server scarica web-dist.zip
 * dall'ultima release e sostituisce la build servita (con backup). Poi basta ricaricare.
 * Se DND5E_ADMIN_TOKEN è impostato, viene chiesto il token.
 */
export async function applyServerUpdate(): Promise<{ ok: boolean; error?: string }> {
  const origin = serverOrigin() ?? (/^https?:$/.test(location.protocol) ? location.origin : null);
  if (!origin) return { ok: false, error: 'nessun server individuato' };
  let r = await fetch(`${origin}/api/update/apply`, { method: 'POST' });
  if (r.status === 401) {
    const tok = window.prompt('Token admin del server (DND5E_ADMIN_TOKEN), lascia vuoto se non impostato:') ?? '';
    r = await fetch(`${origin}/api/update/apply`, { method: 'POST', headers: { 'x-admin-token': tok } });
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) return { ok: false, error: j.error ?? `HTTP ${r.status}` };
  return { ok: true };
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
