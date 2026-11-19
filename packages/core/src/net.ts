/** utility di rete IPv4 per la scansione LAN automatica (discovery P2P senza server noto) */

export function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return -1;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function intToIpv4(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

/** tutti gli host della stessa sottorete /prefix (senza network e broadcast), es. /24 → 254 indirizzi */
export function hostsInSubnet(ip: string, prefix = 24): string[] {
  const addr = ipv4ToInt(ip);
  if (addr < 0) return [];
  const mask = prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const base = (addr & mask) >>> 0;
  const size = (0xffffffff - mask + 1) >>> 0; // numero di indirizzi nella subnet
  const out: string[] = [];
  const last = Math.max(0, size - 2); // salta network (.0) e broadcast (ultimo)
  for (let i = 1; i <= last; i++) {
    out.push(intToIpv4((base + i) >>> 0));
  }
  return out;
}

/** IP locale via trucco ICE WebRTC (funziona dove RTCPeerConnection esiste: browser, Android WebView) */
export async function localIpViaWebRTC(timeoutMs = 1500): Promise<string | null> {
  try {
    if (typeof RTCPeerConnection === 'undefined') return null;
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('ip');
    const ips = new Set<string>();
    pc.addEventListener('icecandidate', (e) => {
      const c = e.candidate?.candidate ?? '';
      const m = c.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
      if (m && !m[1].startsWith('127.')) ips.add(m[1]);
    });
    await pc.createOffer().then((o) => pc.setLocalDescription(o));
    await new Promise((r) => setTimeout(r, timeoutMs));
    pc.close();
    const lan = [...ips].find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
    return lan ?? [...ips][0] ?? null;
  } catch {
    return null;
  }
}
