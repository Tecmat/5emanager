import { hostsInSubnet } from '@dnd5e/core';
import { LAN_BEACON_PORT, detectLocalIp } from './lanBeacon.js';

/**
 * Scansione automatica della rete locale: trova server 5emanager (porta 3001) e
 * host P2P annunciati dai dispositivi (beacon su LAN_BEACON_PORT), sondando
 * /api/info su tutta la sottorete del dispositivo (IP locale via ICE WebRTC).
 * Così l'app "per gente comune" non deve chiedere IP a mano: basta un tasto.
 */

export interface LanServer {
  ip: string;
  port: number;
  name?: string;
  version?: string;
  /** codice invito breve pubblicato dall'host P2P nel beacon (risoluzione serverless via scansione LAN) */
  code?: string;
}

export interface LanPeer extends LanServer {
  /** 'server' = server 5emanager (ws://ip:port), 'p2p' = host P2P sul dispositivo (beacon) */
  kind: 'server' | 'p2p';
}

/** porte sondate: server 5emanager + beacon P2P dei dispositivi */
export const SCAN_PORTS = [3001, LAN_BEACON_PORT];

async function probe(ip: string, port: number, timeoutMs = 600): Promise<LanPeer | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`http://${ip}:${port}/api/info`, { signal: ctl.signal });
      if (!r.ok) return null;
      const j = (await r.json()) as { app?: string; kind?: string; name?: string; version?: string; code?: string };
      if (j.app !== '5emanager') return null;
      return { ip, port, name: j.name, version: j.version, code: j.code, kind: j.kind === 'p2p-host' ? 'p2p' : 'server' };
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

/**
 * Scansiona la /24 locale su tutte le porte note: ritorna server e host P2P trovati
 * (con nome e IP). onProgress(d, t) conta gli IP sondati.
 */
export async function scanLanPeers(onProgress?: (done: number, total: number) => void): Promise<LanPeer[]> {
  // su AppImage (WebKitGTK, niente WebRTC) si usa l'IP nativo: la scansione funziona comunque
  const myIp = await detectLocalIp();
  if (!myIp) return [];
  const hosts = hostsInSubnet(myIp, 24);
  const found: LanPeer[] = [];
  const CONC = 24;
  let done = 0;
  for (let i = 0; i < hosts.length; i += CONC) {
    const batch = hosts.slice(i, i + CONC);
    const results = await Promise.all(
      batch.flatMap((h) => SCAN_PORTS.map((p) => probe(h, p))),
    );
    for (const r of results) if (r) found.push(r);
    done += batch.length;
    onProgress?.(done, hosts.length);
  }
  // include anche il nostro IP: l'host potrebbe essere questo dispositivo
  for (const p of SCAN_PORTS) {
    const self = await probe(myIp, p);
    if (self) found.unshift(self);
  }
  return found;
}

/** solo i server 5emanager (porta 3001) — mantiene il comportamento precedente */
export async function scanLan(port = 3001, onProgress?: (done: number, total: number) => void): Promise<LanServer[]> {
  const peers = await scanLanPeers(onProgress);
  return peers.filter((p) => p.kind === 'server' && p.port === port);
}
