import { Capacitor } from '@capacitor/core';
import { isNewerVersion } from '@dnd5e/core';

/**
 * Check-update in-app, per piattaforma:
 * - web (PWA): confronta /version.json del server + service worker in attesa
 * - desktop (Tauri/AppImage): il check lo fa il processo Rust (reqwest, niente CORS) via comando `check_update`
 * - android (APK): confronta l'ultima release GitHub con la versione della build, apre il download dell'APK
 */

export const REPO = 'Tecmat/5emanager';
export type Platform = 'web' | 'desktop' | 'android';

export interface UpdateInfo {
  platform: Platform;
  current: string;
  latest: string;
  available: boolean;
  pageUrl: string;
  assetUrl?: string;
  assetName?: string;
  checkedAt: string;
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

interface GhAsset { name: string; browser_download_url: string }
interface GhRelease { tag_name: string; html_url: string; assets: GhAsset[] }

async function fetchLatestRelease(): Promise<GhRelease | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return null;
    return (await r.json()) as GhRelease;
  } catch {
    return null;
  }
}

function pickAsset(assets: GhAsset[], platform: Platform): GhAsset | undefined {
  if (platform === 'android') return assets.find((a) => a.name.endsWith('.apk'));
  if (platform === 'desktop') return assets.find((a) => a.name.endsWith('.AppImage'));
  return undefined;
}

/** check via GitHub API (usato da web e android; su desktop il comando Rust è più affidabile) */
export async function checkUpdateViaApi(): Promise<UpdateInfo | null> {
  const platform = detectPlatform();
  const rel = await fetchLatestRelease();
  const current = await getCurrentVersion();
  if (!rel) return null;
  const latest = rel.tag_name.replace(/^v/i, '');
  const asset = pickAsset(rel.assets ?? [], platform);
  return {
    platform,
    current,
    latest,
    available: isNewerVersion(latest, current),
    pageUrl: rel.html_url,
    assetUrl: asset?.browser_download_url,
    assetName: asset?.name,
    checkedAt: new Date().toISOString(),
  };
}

/** check completo: su desktop usa il comando Tauri, altrimenti la GitHub API */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  if (detectPlatform() === 'desktop') {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return (await invoke('check_update')) as UpdateInfo;
    } catch { /* cade sul fallback API */ }
  }
  return checkUpdateViaApi();
}

/** web/PWA: true se c'è un service worker nuovo in attesa o il server serve una build più recente */
export async function checkSwUpdate(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
    if (reg?.waiting) return true;
    const remote = await (await fetch('/version.json', { cache: 'no-store' })).json() as { version?: string };
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
  // il reload ricarica la pagina; il nuovo SW (skipWaiting + clients.claim) serve la build nuova
  setTimeout(() => window.location.reload(), 700);
}

/** android: apre il download dell'APK col browser di sistema (poi un tap installa) */
export async function openAndroidDownload(info: UpdateInfo): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: info.assetUrl ?? info.pageUrl, presentationStyle: 'fullscreen' });
}

export interface DownloadProgress { received: number; total: number }

/** desktop: scarica il nuovo AppImage next all'eseguibile corrente, con progresso via evento Tauri */
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

/** desktop: sostituisce l'AppImage corrente con quello scaricato e riavvia l'app (non ritorna mai) */
export async function applyDesktopUpdate(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('apply_update');
}
