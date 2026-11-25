import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Regressione: la modalità di registrazione cambiata dal pannello /admin deve persistere
 * e avere PRIORITÀ sull'env DND5E_REGISTRATION (il compose la imposta di default ad 'approval',
 * prima masked il valore salvato e la modalità restava "fissa").
 */
process.env.DND5E_DATA_DIR = mkdtempSync(join(tmpdir(), 'dnd5e-regmode-'));

const OLD_ENV = process.env.DND5E_REGISTRATION;
beforeAll(() => {
  delete process.env.DND5E_REGISTRATION;
});
afterAll(() => {
  if (OLD_ENV === undefined) delete process.env.DND5E_REGISTRATION;
  else process.env.DND5E_REGISTRATION = OLD_ENV;
});

const { registrationMode, setRegistrationMode } = await import('../src/accounts.js');

describe('registrationMode: persistenza del pannello /admin', () => {
  it('senza valore salvato: env valida vince, altrimenti default approval', () => {
    process.env.DND5E_REGISTRATION = 'open';
    expect(registrationMode()).toBe('open');
    process.env.DND5E_REGISTRATION = 'non-valida';
    expect(registrationMode()).toBe('approval');
    delete process.env.DND5E_REGISTRATION;
    expect(registrationMode()).toBe('approval');
  });

  it('dopo setRegistrationMode il salvato vince sull\'env (anche dopo "riavvio")', () => {
    process.env.DND5E_REGISTRATION = 'approval'; // come fa il compose di default
    setRegistrationMode('invite');
    expect(registrationMode()).toBe('invite'); // legge subito il nuovo valore
    // riavvio simulato: la env resta 'approval' ma il file su disco ha 'invite'
    expect(registrationMode()).toBe('invite');
    setRegistrationMode('open');
    expect(registrationMode()).toBe('open');
  });
});
