import { describe, expect, it } from 'vitest';
import { applyCampaignAction, createCharacter, DEFAULT_HOUSE_RULES, DEFAULT_STATS, type Campaign, type Character } from '../src/index.js';
import { createSrdRegistry } from '@dnd5e/data-srd';

/**
 * "Anima del PG" (flavor): Character.flavor con aspetto/personalita'/ideali/legami/difetti/storia.
 * - createCharacter lo inizializza a {}
 * - retrocompatibile: schede salvate prima (senza flavor) continuano a funzionare
 * - round-trip JSON (sync server/libreria) preserva i campi
 */

function makeChar(): Character {
  const reg = createSrdRegistry();
  const res = createCharacter({
    name: 'Lyra', raceId: 'human', subraceId: 'human-standard', classId: 'wizard',
    abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 13, cha: 10 },
  }, reg);
  if (!res.character) throw new Error(res.errors.join(','));
  return res.character;
}

function makeCampaign(ch: Character): Campaign {
  return {
    id: 'c1', name: 'Camp', passwordHash: 'x',
    houseRules: { ...DEFAULT_HOUSE_RULES }, custom: {},
    players: [{ id: 'p1', name: 'Lyra', role: 'player', online: true }],
    characters: { p1: ch },
    combat: null, groupInventory: [], groupCurrency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: '', chat: [], stats: { ...DEFAULT_STATS }, blockedPlayers: [],
    createdAt: '', updatedAt: '',
  };
}

describe('flavor (anima del PG)', () => {
  it('createCharacter inizializza flavor a oggetto vuoto', () => {
    expect(makeChar().flavor).toEqual({});
  });

  it('round-trip JSON preserva i campi flavor (sync server/libreria account)', () => {
    const ch = makeChar();
    ch.flavor = { appearance: 'Capelli rossi, mantello blu', ideals: 'La conoscenza above all', backstory: 'Orfana di Waterdeep…' };
    const back = JSON.parse(JSON.stringify(ch)) as Character;
    expect(back.flavor?.appearance).toBe('Capelli rossi, mantello blu');
    expect(back.flavor?.ideals).toBe('La conoscenza above all');
    expect(back.flavor?.backstory).toContain('Waterdeep');
  });

  it('retrocompatibile: scheda vecchia senza flavor resta valida e non viene rotta da setCharacter', () => {
    const reg = createSrdRegistry();
    const legacy = JSON.parse(JSON.stringify(makeChar())) as Character;
    delete legacy.flavor;
    expect(legacy.flavor).toBeUndefined();
    const c = makeCampaign(legacy);
    const [next, err] = applyCampaignAction(c, 'p1', reg, { kind: 'setCharacter', character: legacy });
    expect(err).toBeUndefined();
    expect(next.characters.p1.id).toBe(legacy.id);
    expect(next.characters.p1.flavor).toBeUndefined(); // non inventato: resta opzionale
  });

  it('setCharacter con flavor lo salva in campagna', () => {
    const reg = createSrdRegistry();
    const ch = makeChar();
    ch.flavor = { bonds: 'Devo proteggere mio fratello', flaws: 'Troppo curiosa' };
    const [next, err] = applyCampaignAction(makeCampaign(makeChar()), 'p1', reg, { kind: 'setCharacter', character: ch });
    expect(err).toBeUndefined();
    expect(next.characters.p1.flavor?.bonds).toBe('Devo proteggere mio fratello');
  });
});
