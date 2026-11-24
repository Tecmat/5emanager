import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-pwhash-'));

const campaign = await import('../src/campaign.js');
const accounts = await import('../src/accounts.js');

const legacySha256 = (pw: string) => createHash('sha256').update('5e-' + pw).digest('hex');

describe('hash password: scrypt con sale + verifica legacy', () => {
  it('hashPassword -> formato scrypt$, verifica ok/ko, isLegacyHash', () => {
    const h = campaign.hashPassword('segreta');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(campaign.isLegacyHash(h)).toBe(false);
    expect(campaign.verifyPassword('segreta', h)).toBe(true);
    expect(campaign.verifyPassword('altra', h)).toBe(false);
    // due hash della stessa password sono diversi (sale casuale)
    expect(campaign.hashPassword('segreta')).not.toBe(h);
  });

  it('verifyPassword accetta anche il vecchio hash sha256 (senza sale)', () => {
    const legacy = legacySha256('vecchia-pw');
    expect(campaign.isLegacyHash(legacy)).toBe(true);
    expect(campaign.verifyPassword('vecchia-pw', legacy)).toBe(true);
    expect(campaign.verifyPassword('nope', legacy)).toBe(false);
    // checkPassword (password campagna) funziona con entrambi i formati
    expect(campaign.checkPassword({ passwordHash: legacy } as never, 'vecchia-pw')).toBe(true);
    expect(campaign.checkPassword({ passwordHash: campaign.hashPassword('x') } as never, 'x')).toBe(true);
  });

  it('loginAccount: hash legacy sha256 -> login ok e upgrade automatico a scrypt', () => {
    accounts.createFirstAdmin('admin', 'pw-iniziale');
    // simula un account vecchio: hash sha256 senza sale
    const f = accounts.loadAccountsFile();
    f.accounts['admin'].passwordHash = legacySha256('pw-vecchia');
    accounts.saveAccountsFile(f);
    const acc = accounts.loginAccount('admin', 'pw-vecchia');
    expect(acc.username).toBe('admin');
    const after = accounts.loadAccountsFile().accounts['admin'].passwordHash!;
    expect(after.startsWith('scrypt$')).toBe(true); // upgrade happened
    expect(accounts.loginAccount('admin', 'pw-vecchia').username).toBe('admin'); // ora scrypt
    expect(() => accounts.loginAccount('admin', 'sbagliata')).toThrow(/password errata/i);
  });
});
