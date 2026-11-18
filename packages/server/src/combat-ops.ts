import {
  addCondition,
  addEnemy,
  addXp,
  attack,
  currentCombatant,
  damage,
  damageCombatant,
  heal,
  healCombatant,
  maxHp,
  moveCombatant,
  nextTurn,
  removeCondition,
  rerollInitiatives,
  setCombatantCondition,
  startPartyCombat,
  useBonus,
  useReaction,
  type Character,
  type Registry,
} from '@dnd5e/core';
import type { Campaign, ClientAction } from './protocol.js';
import { saveCampaign } from './campaign.js';

/** applica un'azione del client allo stato della campagna; ritorna [campaign, errore?] */
export function applyAction(c: Campaign, playerId: string, reg: Registry, action: ClientAction): [Campaign, string?] {
  const player = c.players.find((p) => p.id === playerId);
  if (!player) return [c, 'Giocatore non trovato'];
  const isMaster = player.role === 'master';
  const combat = c.combat;
  const cur = combat ? currentCombatant(combat) : undefined;
  const isTurn = cur !== undefined && (cur.isPlayer && c.characters[playerId]?.id === cur.id);

  switch (action.kind) {
    case 'setCharacter':
      c.characters[playerId] = action.character;
      player.characterId = action.character.id;
      saveCampaign(c);
      return [c];

    case 'addCustom':
      // gestito dal chiamante (index.ts) che fa il merge nel registry della campagna
      return [c, 'Usa il messaggio addCustom dedicato'];

    case 'startCombat': {
      if (!isMaster) return [c, 'Solo il master può iniziare il combattimento'];
      const chars: Character[] = c.players
        .map((p) => c.characters[p.id])
        .filter((ch): ch is Character => !!ch);
      if (chars.length === 0) return [c, 'Nessun personaggio caricato: i giocatori devono importare la scheda'];
      c.combat = startPartyCombat(chars, reg);
      saveCampaign(c);
      return [c];
    }

    case 'endCombat':
      if (!isMaster) return [c, 'Solo il master può terminare il combattimento'];
      c.combat = null;
      saveCampaign(c);
      return [c];

    case 'addEnemy':
      if (!isMaster) return [c, 'Solo il master può aggiungere nemici'];
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      c.combat = addEnemy(c.combat, reg, action.enemyId, action.count ?? 1);
      saveCampaign(c);
      return [c];

    case 'rollInitiative':
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      c.combat = rerollInitiatives(c.combat);
      saveCampaign(c);
      return [c];

    case 'attack': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      const attackerId = isMaster && cur ? cur.id : c.characters[playerId]?.id;
      if (!attackerId) return [c, 'Personaggio non trovato'];
      c.combat = attack(c.combat, attackerId, action.targetId, action.attackIndex ?? 0);
      saveCampaign(c);
      return [c];
    }

    case 'move': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      const id = isMaster && cur ? cur.id : c.characters[playerId]?.id;
      if (!id) return [c, 'Personaggio non trovato'];
      c.combat = moveCombatant(c.combat, id, action.amount);
      saveCampaign(c);
      return [c];
    }

    case 'useBonus':
    case 'useReaction': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      const id = isMaster && cur ? cur.id : c.characters[playerId]?.id;
      if (!id) return [c, 'Personaggio non trovato'];
      c.combat = action.kind === 'useBonus' ? useBonus(c.combat, id) : useReaction(c.combat, id);
      saveCampaign(c);
      return [c];
    }

    case 'setCondition': {
      if (!isMaster) return [c, 'Solo il master può gestire le condizioni'];
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      c.combat = setCombatantCondition(c.combat, action.targetId, action.conditionId, action.on, action.rounds ?? 1);
      saveCampaign(c);
      return [c];
    }

    case 'damage':
    case 'heal': {
      if (!isMaster) return [c, 'Solo il master può modificare i PF direttamente'];
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      c.combat = action.kind === 'damage' ? damageCombatant(c.combat, action.targetId, action.amount) : healCombatant(c.combat, action.targetId, action.amount);
      saveCampaign(c);
      return [c];
    }

    case 'nextTurn': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      c.combat = nextTurn(c.combat);
      saveCampaign(c);
      return [c];
    }

    // --- pannello master: agisce sul PG "di nascosto" (nessuna voce nel log pubblico) ---
    case 'masterDamage':
    case 'masterHeal':
    case 'masterAddXp':
    case 'masterSetCondition': {
      if (!isMaster) return [c, 'Solo il master può usare queste azioni'];
      const ch = c.characters[action.playerId];
      if (!ch) return [c, 'Quel giocatore non ha caricato la scheda'];
      if (action.kind === 'masterDamage') {
        c.characters[action.playerId] = damage(ch, action.amount);
        if (c.combat) c.combat = damageCombatant(c.combat, ch.id, action.amount);
      } else if (action.kind === 'masterHeal') {
        c.characters[action.playerId] = heal(ch, action.amount, maxHp(ch, reg));
        if (c.combat) c.combat = healCombatant(c.combat, ch.id, action.amount);
      } else if (action.kind === 'masterAddXp') {
        c.characters[action.playerId] = addXp(ch, action.amount);
      } else {
        c.characters[action.playerId] = action.on ? addCondition(ch, action.conditionId) : removeCondition(ch, action.conditionId);
        if (c.combat) c.combat = setCombatantCondition(c.combat, ch.id, action.conditionId, action.on, 99);
      }
      saveCampaign(c);
      return [c];
    }

    default:
      return [c, 'Azione sconosciuta: ' + (action as { kind: string }).kind];
  }
}
