import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, parseAssetUrlsFromExpandedAssets, parseLatestTagFromAtom, parseVersion } from '../src/index.js';

describe('version compare', () => {
  it('parseVersion normalizza v e padding', () => {
    expect(parseVersion('v0.1.14')).toEqual([0, 1, 14]);
    expect(parseVersion('0.1')).toEqual([0, 1, 0]);
    expect(parseVersion('1.2.3-beta')).toEqual([1, 2, 3]);
  });
  it('compareVersions', () => {
    expect(compareVersions('0.1.15', '0.1.14')).toBeGreaterThan(0);
    expect(compareVersions('v0.1.14', '0.1.14')).toBe(0);
    expect(compareVersions('0.2.0', '0.1.99')).toBeGreaterThan(0);
    expect(compareVersions('0.1.9', '0.1.10')).toBeLessThan(0);
  });
  it('isNewerVersion', () => {
    expect(isNewerVersion('v0.1.15', '0.1.14')).toBe(true);
    expect(isNewerVersion('0.1.14', '0.1.14')).toBe(false);
    expect(isNewerVersion('0.1.13', '0.1.14')).toBe(false);
  });
});

describe('fallback HTML GitHub (senza API)', () => {
  it('parseLatestTagFromAtom prende la prima entry', () => {
    const atom = `<?xml version="1.0"?><feed><entry><id>tag:v0.1.15</id><title>v0.1.15</title><link href="https://github.com/Tecmat/5emanager/releases/tag/v0.1.15"/></entry><entry><title>v0.1.14</title></entry></feed>`;
    expect(parseLatestTagFromAtom(atom)).toBe('v0.1.15');
    expect(parseLatestTagFromAtom('<feed></feed>')).toBeNull();
  });
  it('parseAssetUrlsFromExpandedAssets estrae gli href degli asset', () => {
    const html = `<a href="/Tecmat/5emanager/releases/download/v0.1.15/5e.Manager_0.1.15_amd64.AppImage">AppImage</a>
      <a href="https://github.com/Tecmat/5emanager/releases/download/v0.1.15/app-debug.apk">apk</a>
      <a href="/Tecmat/5emanager/releases/tag/v0.1.15">pagina</a>`;
    const assets = parseAssetUrlsFromExpandedAssets(html, 'v0.1.15');
    expect(assets.map((a) => a.name)).toEqual(['5e.Manager_0.1.15_amd64.AppImage', 'app-debug.apk']);
    expect(assets[0].url).toBe('https://github.com/Tecmat/5emanager/releases/download/v0.1.15/5e.Manager_0.1.15_amd64.AppImage');
    expect(assets[1].url).toBe('https://github.com/Tecmat/5emanager/releases/download/v0.1.15/app-debug.apk');
  });
});
