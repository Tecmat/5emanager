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
  start(opts: { port: number; name: string }): Promise<{ address?: string }>;
  send(opts: { clientId: string; msg: string }): Promise<void>;
  broadcast(opts: { msg: string }): Promise<{ sent?: number }>;
  stop(): Promise<void>;
  /** IP IPv4 locale del dispositivo (interfacce di rete) — serve quando WebRTC manca (WebKitGTK) */
  localIp(): Promise<{ ip?: string }>;
}
// plugin nativo custom (patchato in CI in apps/web/android-overlay/LanBeaconPlugin.java)
const LanBeacon = registerPlugin<LanBeaconPlugin>('LanBeacon');

async function isTauri(): Promise<boolean> {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export async function beaconStart(port: number, name: string): Promise<string> {
  if (await isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke('lan_beacon_start', { port, name })) as string;
  }
  const r = await LanBeacon.start({ port, name });
  return r.address ?? `0.0.0.0:${port}`;
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

/**
 * IP locale del dispositivo: prima il trucco ICE WebRTC, poi (su app native, es. AppImage
 * su WebKitGTK dove RTCPeerConnection manca) la lettura nativa delle interfacce di rete.
 */
let ipCache: { ip: string; at: number } | null = null;

export async function detectLocalIp(): Promise<string | null> {
  if (ipCache && Date.now() - ipCache.at < 30_000) return ipCache.ip;
  const viaRtc = await localIpViaWebRTC(1200);
  if (viaRtc) {
    ipCache = { ip: viaRtc, at: Date.now() };
    return viaRtc;
  }
  try {
    if (await isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const ip = (await invoke('lan_local_ip')) as string | null;
      if (ip) return ip;
    } else if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      const r = await LanBeacon.localIp();
      if (r.ip) {
        ipCache = { ip: r.ip, at: Date.now() };
        return r.ip;
      }
    }
  } catch { /* ignora */ }
  return null;
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
