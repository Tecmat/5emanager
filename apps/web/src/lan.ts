import { hostsInSubnet, localIpViaWebRTC } from '@dnd5e/core';

/**
 * Scansione automatica della rete locale: trova i server 5emanager sondando /api/info
 * su tutta la sottorete del dispositivo (IP locale preso via ICE WebRTC).
 * Così l'app "per gente comune" non deve chiedere IP a mano: basta un tasto.
 */

export interface LanServer {
  ip: string;
  port: number;
  name?: string;
  version?: string;
}

async function probe(ip: string, port: number, timeoutMs = 600): Promise<LanServer | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`http://${ip}:${port}/api/info`, { signal: ctl.signal });
      if (!r.ok) return null;
      const j = (await r.json()) as { app?: string; name?: string; version?: string };
      if (j.app !== '5emanager') return null;
      return { ip, port, name: j.name, version: j.version };
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

/** scansione della /24 locale: ritorna i server 5emanager trovati (con nome host e IP) */
export async function scanLan(port = 3001, onProgress?: (done: number, total: number) => void): Promise<LanServer[]> {
  const myIp = await localIpViaWebRTC(1200);
  if (!myIp) return [];
  const hosts = hostsInSubnet(myIp, 24);
  const found: LanServer[] = [];
  const CONC = 24;
  let done = 0;
  for (let i = 0; i < hosts.length; i += CONC) {
    const batch = hosts.slice(i, i + CONC);
    const results = await Promise.all(batch.map((h) => probe(h, port)));
    for (const r of results) if (r) found.push(r);
    done += batch.length;
    onProgress?.(done, hosts.length);
  }
  // include anche il nostro IP: l'host potrebbe essere questo dispositivo
  const self = await probe(myIp, port);
  if (self) found.unshift(self);
  return found;
}
