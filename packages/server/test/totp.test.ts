import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  otpauthUrl,
  totpAt,
  verifyTotp,
} from '../src/totp.js';

// vettori RFC 6238 (SHA1, 8 cifre), secret ASCII "12345678901234567890"
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP RFC 6238 (HMAC-SHA1)', () => {
  it('base32 roundtrip', () => {
    const secret = generateTotpSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890');
  });
  it('vettori di test RFC 6238 (8 cifre)', () => {
    for (const [t, expected] of RFC_VECTORS) {
      expect(totpAt(RFC_SECRET, t * 1000, 30, 8)).toBe(expected);
    }
  });
  it('verifyTotp: accetta il codice corrente e la finestra ±1, rifiuta gli altri', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = totpAt(secret, now);
    expect(verifyTotp(secret, code, 1, now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), 1, now)).toBe(true); // step precedente
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), 1, now)).toBe(true); // step successivo
    expect(verifyTotp(secret, totpAt(secret, now - 90_000), 1, now)).toBe(false); // fuori finestra
    expect(verifyTotp(secret, '000000', 1, now)).toBe(totpAt(secret, now) === '000000'); // improbabile ma deterministico
    expect(verifyTotp(secret, 'abc', 1, now)).toBe(false);
    expect(verifyTotp(secret, '12345', 1, now)).toBe(false);
  });
  it('otpauthUrl contiene secret, issuer e account', () => {
    const u = otpauthUrl('JBSWY3DPEHPK3PXP', '5e Manager', 'alice@example.com');
    expect(u.startsWith('otpauth://totp/5e%20Manager:alice%40example.com?')).toBe(true);
    expect(u).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(u).toContain('issuer=5e%20Manager');
  });
  it('codici di backup: formato, hash stabili, monouso lato hash', () => {
    const codes = generateBackupCodes(8);
    expect(codes).toHaveLength(8);
    for (const c of codes) expect(c).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(new Set(codes).size).toBe(8);
    expect(hashBackupCode('ABCD-1234')).toBe(hashBackupCode('abcd1234')); // normalizzato
    expect(hashBackupCode('ABCD-1234')).not.toBe(hashBackupCode('ABCD-1235'));
  });
});
