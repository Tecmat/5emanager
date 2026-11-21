import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 cifre) in purezza — zero dipendenze, solo node:crypto.
 * Usato per la 2FA con app authenticator (Google Authenticator, Aegis, ecc.).
 */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** secret TOTP nuovo (160 bit) in base32 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** codice TOTP a un istante (default: ora, step 30 s, 6 cifre) */
export function totpAt(secretB32: string, timeMs: number, stepSec = 30, digits = 6): string {
  const key = base32Decode(secretB32);
  const counter = Math.floor(timeMs / 1000 / stepSec);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpNow(secretB32: string, stepSec = 30, digits = 6): string {
  return totpAt(secretB32, Date.now(), stepSec, digits);
}

/** verifica con finestra ±window step (tolleranza per il clock skew) */
export function verifyTotp(secretB32: string, code: string, window = 1, now = Date.now()): boolean {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  for (let w = -window; w <= window; w++) {
    if (totpAt(secretB32, now + w * 30_000) === c) return true;
  }
  return false;
}

/** URL otpauth:// per il QR delle app authenticator */
export function otpauthUrl(secret: string, issuer: string, account: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** codici di backup monouso, formato XXXX-XXXX */
export function generateBackupCodes(n = 8): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const hex = randomBytes(4).toString('hex').toUpperCase();
    out.push(hex.slice(0, 4) + '-' + hex.slice(4));
  }
  return out;
}

/** i backup si salvano solo come hash (come le password) */
export function hashBackupCode(code: string): string {
  return createHash('sha256').update('5e-backup-' + code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');
}
