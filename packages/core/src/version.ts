/** utility di confronto versioni (semver light) per il check-update in-app */

/** normalizza "v0.1.14" / "0.1.14-beta" → [0,1,14] (le parti non numeriche diventano 0) */
export function parseVersion(v: string): number[] {
  const clean = v.trim().replace(/^v/i, '').split(/[-+]/)[0];
  const parts = clean.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  while (parts.length < 3) parts.push(0);
  return parts;
}

/** >0 se a è più recente di b, 0 se uguali, <0 se più vecchia */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** true se `latest` è più recente di `current` */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
