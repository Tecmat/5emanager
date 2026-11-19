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

/**
 * Fallback senza API: parsing dell'Atom feed delle release di GitHub
 * (github.com non ha rate limit come api.github.com).
 * Ritorna il tag della prima entry (la più recente), es. "v0.1.15".
 */
export function parseLatestTagFromAtom(xml: string): string | null {
  const entry = xml.indexOf('<entry>');
  if (entry < 0) return null;
  const rest = xml.slice(entry);
  const t0 = rest.indexOf('<title>');
  if (t0 < 0) return null;
  const t1 = rest.indexOf('</title>', t0);
  if (t1 < 0) return null;
  const tag = rest.slice(t0 + 7, t1).trim();
  return /^v?\d+(\.\d+)*/.test(tag) ? tag : null;
}

/** parsing della pagina `releases/expanded_assets/<tag>`: ritorna gli URL degli asset */
export function parseAssetUrlsFromExpandedAssets(html: string, tag: string): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  const needle = '/releases/download/';
  let i = 0;
  while (true) {
    const h = html.indexOf('href="', i);
    if (h < 0) break;
    const q0 = h + 6;
    const q1 = html.indexOf('"', q0);
    if (q1 < 0) break;
    const href = html.slice(q0, q1);
    i = q1 + 1;
    const dl = href.indexOf(needle);
    if (dl < 0) continue;
    if (href.endsWith('/')) continue;
    const url = href.startsWith('http') ? href : `https://github.com${href}`;
    const name = decodeURIComponent(href.slice(dl + needle.length).split('/').pop() ?? '');
    if (name && !out.some((a) => a.name === name)) out.push({ name, url });
  }
  void tag;
  return out;
}
