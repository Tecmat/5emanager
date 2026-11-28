import { describe, expect, it } from 'vitest';
import { createCharacter, validateBackgroundDef } from '../src/index.js';
import { createSrdRegistry, SRD_DATA } from '@dnd5e/data-srd';

/** background come entita' SRD: validazione dati, registry, skill applicate in creazione */

describe('background come entita SRD', () => {
  it('tutti i background SRD passano la validazione', () => {
    expect(SRD_DATA.backgrounds?.length).toBeGreaterThan(5);
    for (const b of SRD_DATA.backgrounds ?? []) expect(validateBackgroundDef(b)).toEqual([]);
  });

  it('il registry carica i background', () => {
    const reg = createSrdRegistry();
    expect(reg.backgrounds.get('sage')?.name).toBe('Saggio');
  });

  it('createCharacter con background applica le skill del background', () => {
    const reg = createSrdRegistry();
    const res = createCharacter({
      name: 'Sage', raceId: 'human', classId: 'wizard', background: 'sage',
      abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 13, cha: 10 },
    }, reg);
    if (!res.character) throw new Error(res.errors.join(','));
    expect(res.character.background).toBe('sage');
    expect(res.character.proficiency.skills).toContain('arcana');
    expect(res.character.proficiency.skills).toContain('history');
  });

  it('background ignoto -> errore', () => {
    const reg = createSrdRegistry();
    const res = createCharacter({
      name: 'X', raceId: 'human', classId: 'wizard', background: 'non-esiste',
      abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 13, cha: 10 },
    }, reg);
    expect(res.character).toBeUndefined();
    expect(res.errors.join(' ')).toContain('Background non trovato');
  });
});

