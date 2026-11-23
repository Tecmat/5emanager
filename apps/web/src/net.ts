import { Capacitor } from '@capacitor/core';

export type Handler = (msg: any) => void;

export class NetClient {
  ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  onMessage(h: Handler): void {
    this.handlers.push(h);
  }
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      // timeout: un host irraggiungibile/filtrato non deve bloccare il pulsante su "Connessione..."
      const to = setTimeout(() => {
        try { ws.close(); } catch { /* ignora */ }
        reject(new Error('Timeout connessione a ' + url + ' (8s): host irraggiungibile?'));
      }, 8000);
      ws.onopen = () => { clearTimeout(to); resolve(); };
      ws.onerror = () => { clearTimeout(to); reject(new Error('Connessione a ' + url + ' fallita')); };
      ws.onclose = () => { clearTimeout(to); this.handlers.forEach((h) => h({ t: 'closed' })); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        this.handlers.forEach((h) => h(m));
      };
    });
  }
  send(m: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  /** misura il round-trip verso il server; reject se non connesso o scaduto */
  ping(timeoutMs = 5000): Promise<{ rtt: number; serverTime: number }> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Non connesso'));
        return;
      }
      const id = Math.random().toString(36).slice(2);
      const t0 = performance.now();
      const timer = setTimeout(() => {
        this.handlers = this.handlers.filter((h) => h !== h2);
        reject(new Error('Ping scaduto (timeout)'));
      }, timeoutMs);
      const h2: Handler = (m) => {
        if (m.t === 'pong' && m.id === id) {
          clearTimeout(timer);
          this.handlers = this.handlers.filter((h) => h !== h2);
          resolve({ rtt: performance.now() - t0, serverTime: m.serverTime });
        }
      };
      this.onMessage(h2);
      this.send({ t: 'ping', id });
    });
  }
  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

/** true se l'host e' "locale" (localhost, 127.0.0.1, ::1, *.localhost es. tauri.localhost), con o senza porta */
export function isLocalhostHost(host: string): boolean {
  return /(^|\.)localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$|^(\[::1\]|::1)(:\d+)?$/.test(host.trim().toLowerCase());
}

/** URL WebSocket speculare alla pagina: wss:// se la pagina e' in https (es. dietro nginx), altrimenti ws:// */
export function wsUrlFromLocation(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}`;
}

/**
 * normalizza un URL server inserito a mano in un URL WebSocket:
 * https://host -> wss://host, http://host -> ws://host, ws(s):// resta, "host:3001" -> ws://host:3001
 */
export function toWsUrl(u: string): string {
  const s = u.trim();
  if (!s) return s;
  if (/^wss?:\/\//i.test(s)) return s;
  if (/^https:\/\//i.test(s)) return s.replace(/^https:/i, 'wss:');
  if (/^http:\/\//i.test(s)) return s.replace(/^http:/i, 'ws:');
  return 'ws://' + s;
}

/** URL http(s) dello stesso server da un URL ws(s) (per aprire /admin, /setup ecc.) */
export function httpUrlFromWs(u: string): string {
  const s = u.trim();
  if (/^wss:/i.test(s)) return s.replace(/^wss:/i, 'https:');
  if (/^ws:/i.test(s)) return s.replace(/^ws:/i, 'http:');
  if (/^https?:\/\//i.test(s)) return s;
  return 'http://' + s;
}

/**
 * true quando l'app gira come webapp servita DAL server (non vite dev 5173, non app nativa):
 * in quel caso il multiplayer e' il server stesso e la sezione P2P non ha senso.
 */
export function isServerWebapp(): boolean {
  try {
    if (Capacitor.isNativePlatform()) return false;
  } catch { /* non nativo */ }
  if (typeof location === 'undefined' || !location.host) return false;
  return location.port !== '5173';
}

/**
 * URL WS di default: in web usa l'origin della pagina (il server che serve l'app).
 * Su app nativa (APK: location = https://localhost) NON ha senso ws://localhost:
 * si lascia vuoto e si usa la scansione LAN / l'URL salvato o inserito a mano.
 */
export const defaultWsUrl = (): string => {
  if (typeof location !== 'undefined' && location.host && location.port !== '5173' && !isLocalhostHost(location.host)) {
    return wsUrlFromLocation(location);
  }
  try {
    if (Capacitor.isNativePlatform()) return '';
  } catch { /* non nativo */ }
  return 'ws://127.0.0.1:3001';
};
