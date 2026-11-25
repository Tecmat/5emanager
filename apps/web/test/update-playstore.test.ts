// @vitest-environment jsdom
/**
 * Su Play Store il self-update via APK è vietato (policy Google): isPlayStoreInstall()
 * rileva l'installer com.android.vending via plugin nativo; su web/non-android -> false.
 */
import { describe, expect, it } from 'vitest';
import { isPlayStoreInstall } from '../src/update.js';

describe('isPlayStoreInstall', () => {
  it('su web (non nativo) -> false, mai self-update APK', async () => {
    expect(await isPlayStoreInstall()).toBe(false);
  });
});
