import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, parseVersion } from '../src/index.js';

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
