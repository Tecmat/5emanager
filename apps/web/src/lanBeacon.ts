import { Capacitor, registerPlugin } from '@capacitor/core';
import { localIpViaWebRTC } from '@dnd5e/core';

/**
 * Bridge verso il "beacon LAN" nativo (Tauri desktop / APK Android): il dispositivo
 * host apre un mini server HTTP+WS sulla rete locale (porta 3177 di default).
 *  - GET /api/info  -> { app:'5emanager', kind:'p2p-host', name, version, port }
 *    (cosi' la scansione LAN degli altri dispositivi lo trova da solo)
 *  - WS  /ws        -> trasporto di gioco diretto host<->client (niente WebRTC, niente server)
 *
 * Eventi nativi -> JS: window.__lanEvt(["open"|"msg"|"close", clientId, payload?])
 * JS -> nativo: beaconSend / beaconBroadcast / beaconStop qui sotto.
 */

export const LAN_BEACON_PORT = 3177;

export type LanEvt =
  | ['open', string]
  | ['msg', string, string]
  | ['close', string];

let globalInstalled = false;

function ensureGlobal(): void {
  if (globalInstalled) return;
  globalInstalled = true;
  (window as unknown as { __lanEvt?: (arr: LanEvt) => void }).__lanEvt = (arr: LanEvt) => {
    window.dispatchEvent(new CustomEvent<LanEvt>('lan-evt', { detail: arr }));
  };
}

/** sottoscrivi gli eventi del beacon nativo; ritorna la funzione di unsubscribe */
export function onLanEvt(cb: (e: LanEvt) => void): () => void {
  ensureGlobal();
  const h = (ev: Event) => cb((ev as CustomEvent<LanEvt>).detail);
  window.addEventListener('lan-evt', h);
  return () => window.removeEventListener('lan-evt', h);
}

/** true se questo dispositivo puo' fare da host LAN (app nativa desktop o Android col plugin LanBeacon) */
export function lanBeaconSupported(): boolean {
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return true;
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android' &&
      Capacitor.isPluginAvailable('LanBeacon')
    );
  } catch {
    return false;
  }
}

interface LanBeaconPlugin {
  start(opts: { port: number; name: string; code?: string }): Promise<{ address?: string }>;
  /** aggiorna il codice invito breve pubblicato in /api/info senza riavviare il beacon */
  setCode(opts: { code: string }): Promise<void>;
  send(opts: { clientId: string; msg: string }): Promise<void>;
  broadcast(opts: { msg: string }): Promise<{ sent?: number }>;
  stop(): Promise<void>;
  /** IP IPv4 locale del dispositivo (interfacce di rete) — serve quando WebRTC manca (WebKitGTK) */
  localIp(): Promise<{ ip?: string }>;
  /** TUTTI gli IP IPv4 locali (utile con WiFi + hotspot contemporanei) */
  localIps(): Promise<{ ips?: string[] }>;
}
// plugin nativo custom (patchato in CI in apps/web/android-overlay/LanBeaconPlugin.java)
const LanBeacon = registerPlugin<LanBeaconPlugin>('LanBeacon');

async function isTauri(): Promise<boolean> {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export async function beaconStart(port: number, name: string, code?: string): Promise<string> {
  if (await isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke('lan_beacon_start', { port, name, code: code ?? null })) as string;
  }
  const r = await LanBeacon.start({ port, name, code });
  return r.address ?? `0.0.0.0:${port}`;
}

/** pubblica/aggiorna il codice invito breve nel /api/info del beacon (serverless) */
export async function beaconSetCode(code: string): Promise<void> {
  try {
    if (await isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('lan_beacon_set_code', { code });
      return;
    }
    await LanBeacon.setCode({ code });
  } catch { /* beacon non attivo */ }
}

export async function beaconSend(clientId: string, msg: string): Promise<void> {
  if (await isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('lan_beacon_send', { clientId, msg });
    return;
  }
  await LanBeacon.send({ clientId, msg });
}

export async function beaconBroadcast(msg: string): Promise<number> {
  if (await isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke('lan_beacon_broadcast', { msg })) as number;
  }
  const r = await LanBeacon.broadcast({ msg });
  return r.sent ?? 0;
}

/** timeout di sicurezza sulle chiamate native (un plugin che non risponde non deve bloccare la UI) */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * IP locale del dispositivo: prima il trucco ICE WebRTC, poi (su app native, es. AppImage
 * su WebKitGTK dove RTCPeerConnection manca) la lettura nativa delle interfacce di rete.
 */
let ipCache: { ip: string; at: number } | null = null;

export async function detectLocalIp(): Promise<string | null> {
  if (ipCache && Date.now() - ipCache.at < 30_000) return ipCache.ip;
  const viaRtc = await withTimeout(localIpViaWebRTC(1200), 3000).catch(() => null);
  if (viaRtc) {
    ipCache = { ip: viaRtc, at: Date.now() };
    return viaRtc;
  }
  try {
    if (await isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const ip = (await withTimeout(invoke('lan_local_ip'), 3000)) as string | null;
      if (ip) return ip;
    } else if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      const r = await withTimeout(LanBeacon.localIp(), 3000);
      if (r.ip) {
        ipCache = { ip: r.ip, at: Date.now() };
        return r.ip;
      }
    }
  } catch { /* ignora */ }
  return null;
}

/**
 * tutti gli IP IPv4 locali del dispositivo (WiFi, hotspot, ecc.): quando il telefono ha più
 * interfacce attive quello mostrato nel QR potrebbe non essere quello che gli altri raggiungono.
 */
export async function detectLocalIps(): Promise<string[]> {
  try {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      const r = await withTimeout(LanBeacon.localIps(), 3000);
      if (r.ips && r.ips.length > 0) return r.ips;
    }
  } catch { /* cade sotto */ }
  const one = await detectLocalIp();
  return one ? [one] : [];
}

export async function beaconStop(): Promise<void> {
  try {
    if (await isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('lan_beacon_stop');
      return;
    }
    await LanBeacon.stop();
  } catch {
    /* il beacon era gia' fermo */
  }
}
