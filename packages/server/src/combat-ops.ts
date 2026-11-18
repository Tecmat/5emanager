import { applyCampaignAction, type Campaign, type ClientAction, type Registry } from '@dnd5e/core';
import { saveCampaign } from './campaign.js';

/**
 * applica un'azione allo stato della campagna: la logica è in core (applyCampaignAction,
 * condivisa con l'host P2P nel browser); qui solo si salva su disco.
 * Ritorna [campaign, errore?].
 */
export function applyAction(c: Campaign, playerId: string, reg: Registry, action: ClientAction): [Campaign, string?] {
  const [next, err] = applyCampaignAction(c, playerId, reg, action);
  if (err) return [next, err];
  saveCampaign(next);
  return [next];
}
