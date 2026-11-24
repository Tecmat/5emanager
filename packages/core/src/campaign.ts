import type { Character, Currency, HouseRules, InventoryItem, ItemRarity } from './types.js';
import type { Registry, SrdData } from './registry.js';
import type { CombatState, CombatTemplate } from './rules/combat.js';
import {
  addEnemy,
  attack,
  clearTemplate,
  currentCombatant,
  damageCombatant,
  ensureMap,
  healCombatant,
  moveCombatant,
  moveToken,
  nextTurn,
  rerollInitiatives,
  setCombatantCondition,
  setMapSize,
  setTemplate,
  startPartyCombat,
  useBonus,
  useReaction,
  type AttackMods,
} from './rules/combat.js';
import { addCurrencyRaw, addItem } from './rules/inventory.js';
import { exhaustionEffects } from './rules/exhaustion.js';
import { hasAdvantage, damageBonusDice } from './rules/effects.js';
import { addCondition, removeCondition } from './rules/conditions.js';
import { addXp, damage, heal } from './character.js';
import { maxHp } from './rules/derived.js';

export interface PlayerInfo {
  id: string;
  name: string;
  role: 'master' | 'player';
  characterId?: string;
  /** false = disconnesso (in grace period, in attesa di riconnessione); undefined/true = online */
  online?: boolean;
}

/** marca un giocatore online/offline (usato da server e host P2P su disconnessione/riconnessione) */
export function setPlayerOnline(c: Campaign, playerId: string, online: boolean): Campaign {
  const p = c.players.find((x) => x.id === playerId);
  if (p) p.online = online;
  return c;
}

/** messaggio della chat di campagna */
export interface ChatMessage {
  id: string;
  fromId: string;
  from: string;
  text: string;
  at: string;
}

export interface Campaign {
  id: string;
  name: string;
  passwordHash: string;
  houseRules: HouseRules;
  /** contenuti custom della campagna (aggiunti al set SRD) */
  custom: Partial<SrdData>;
  players: PlayerInfo[];
  characters: Record<string, Character>;
  combat: CombatState | null;
  /** inventario di gruppo condiviso (loot) */
  groupInventory: InventoryItem[];
  /** tesoreria di gruppo */
  groupCurrency: Currency;
  /** note di sessione condivise (visibili a tutti, modificabili dal master) */
  notes: string;
  /** chat di campagna (ultimi messaggi, cap 200) */
  chat: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

const ZERO_CURRENCY: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

/** snapshot di una campagna P2P salvata in locale dall'host (sincronizzabile sull'account remoto) */
export interface SavedCampaignSnapshot {
  id: string;
  name: string;
  savedAt: string;
  /** snapshot della campagna con passwordHash azzerato (la password non si salva mai) */
  campaign: Campaign;
}

/** riempe i campi mancanti delle campagne salvate prima della migrazione (group inventory, note...) */
export function migrateCampaign(c: Campaign): Campaign {
  return {
    ...c,
    groupInventory: c.groupInventory ?? [],
    groupCurrency: c.groupCurrency ?? { ...ZERO_CURRENCY },
    notes: c.notes ?? '',
    chat: c.chat ?? [],
  };
}

/**
 * Prepara una campagna P2P salvata in locale per essere ripresa dall'host:
 * **stesso id** (così resta una sola voce nella lista delle salvate e la scheda
 * "campagna:<id>" del master resta collegata), solo il master come giocatore,
 * niente schede/combattimento delle sessioni passate (i giocatori rientrano con
 * un id nuovo e ricaricano la scheda).
 * La password NON viene salvata su disco: è facoltativa — quella passata diventa
 * la nuova passwordHash (stringa vuota = anyone can join).
 * Restano: nome, house-rules, custom, note, inventario/tesoro di gruppo, createdAt.
 */
export function resumeCampaign(saved: Campaign, password: string, master: PlayerInfo): Campaign {
  return {
    ...migrateCampaign(saved),
    id: saved.id,
    passwordHash: password,
    players: [master],
    characters: {},
    combat: null,
    updatedAt: new Date().toISOString(),
  };
}

let uidCounter = 0;
export function uid(prefix = 'id'): string {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type ClientAction =
  | { kind: 'setCharacter'; character: Character }
  | { kind: 'startCombat' }
  | { kind: 'addEnemy'; enemyId: string; count?: number }
  | { kind: 'rollInitiative' }
  | { kind: 'attack'; targetId: string; attackIndex?: number }
  | { kind: 'move'; amount: number }
  | { kind: 'useBonus' }
  | { kind: 'useReaction' }
  | { kind: 'setCondition'; targetId: string; conditionId: string; on: boolean; rounds?: number }
  | { kind: 'damage'; targetId: string; amount: number }
  | { kind: 'heal'; targetId: string; amount: number }
  | { kind: 'nextTurn' }
  | { kind: 'endCombat' }
  | { kind: 'addCustom'; data: Partial<SrdData> }
  | { kind: 'leave' }
  | { kind: 'kickPlayer'; playerId: string }
  | { kind: 'saveP2PCampaign'; saved: SavedCampaignSnapshot }
  | { kind: 'deleteP2PCampaign'; id: string }
  | { kind: 'saveCharacter'; character: Character }
  | { kind: 'deleteCharacter'; characterId: string }
  | { kind: 'useCharacter'; characterId: string }
  | { kind: 'masterDamage'; playerId: string; amount: number }
  | { kind: 'masterHeal'; playerId: string; amount: number }
  | { kind: 'masterAddXp'; playerId: string; amount: number }
  | { kind: 'masterSetCondition'; playerId: string; conditionId: string; on: boolean }
  | { kind: 'dropConcentration' }
  | { kind: 'deleteCampaign' }
  | { kind: 'masterAddXpAll'; amount: number }
  | { kind: 'groupAddItem'; item: { name: string; quantity?: number; weight?: number; valueGp?: number; rarity?: ItemRarity; magic?: boolean; spellId?: string } }
  | { kind: 'chat'; text: string }
  | { kind: 'groupRemoveItem'; itemId: string }
  | { kind: 'groupGiveItem'; itemId: string; playerId: string }
  | { kind: 'groupAddCurrency'; amount: Partial<Currency> }
  | { kind: 'setTemplate'; template: CombatTemplate }
  | { kind: 'clearTemplate' }
  | { kind: 'setCampaignNote'; text: string }
  /** mappa tattica: sposta il token di un combattente (master sempre, PG sul proprio turno) */
  | { kind: 'moveToken'; targetId: string; x: number; y: number }
  /** mappa tattica: ridimensiona la griglia (solo master) */
  | { kind: 'setMapSize'; cols: number; rows: number };

/**
 * applica un'azione allo stato della campagna — PURO (niente I/O, niente fs):
 * usata dal server Node (che poi salva su disco) e dall'host P2P nel browser.
 * Ritorna [campaign, errore?].
 */
export function applyCampaignAction(c: Campaign, playerId: string, reg: Registry, action: ClientAction): [Campaign, string?] {
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
      return [c];

    case 'chat': {
      const text = String(action.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
      if (!text) return [c, 'Messaggio vuoto'];
      const msg: ChatMessage = { id: uid('msg'), fromId: playerId, from: player.name, text, at: new Date().toISOString() };
      c.chat = [...(c.chat ?? []), msg].slice(-200);
      return [c];
    }

    case 'leave':
      c.players = c.players.filter((x) => x.id !== playerId);
      return [c];

    case 'kickPlayer': {
      if (!isMaster) return [c, 'Solo il master può espellere un giocatore'];
      if (action.playerId === playerId) return [c, 'Non puoi espellere te stesso (usa "Esci")'];
      if (!c.players.some((p) => p.id === action.playerId)) return [c, 'Giocatore non trovato'];
      c.players = c.players.filter((x) => x.id !== action.playerId);
      delete c.characters[action.playerId];
      return [c];
    }

    case 'addCustom': {
      if (!isMaster) return [c, 'Solo il master può aggiungere contenuti custom'];
      const merge = (key: keyof SrdData) => {
        if (Array.isArray(action.data[key])) {
          const cur = (c.custom[key] ?? []) as unknown[];
          c.custom[key] = [...cur, ...(action.data[key] as unknown[])] as never;
        }
      };
      (['classes', 'subclasses', 'races', 'spells', 'weapons', 'armors', 'feats', 'enemies'] as (keyof SrdData)[]).forEach(merge);
      return [c];
    }

    case 'startCombat': {
      if (!isMaster) return [c, 'Solo il master può iniziare il combattimento'];
      const chars: Character[] = c.players.map((p) => c.characters[p.id]).filter((ch): ch is Character => !!ch);
      if (chars.length === 0) return [c, 'Nessun personaggio caricato: i giocatori devono importare la scheda'];
      c.combat = startPartyCombat(chars, reg);
      return [c];
    }

    case 'endCombat':
      if (!isMaster) return [c, 'Solo il master può terminare il combattimento'];
      c.combat = null;
      return [c];

    case 'addEnemy':
      if (!isMaster) return [c, 'Solo il master può aggiungere nemici'];
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      c.combat = addEnemy(c.combat, reg, action.enemyId, action.count ?? 1);
      return [c];

    case 'rollInitiative':
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      c.combat = rerollInitiatives(c.combat);
      return [c];

    case 'attack': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      const attackerId = isMaster && cur ? cur.id : c.characters[playerId]?.id;
      if (!attackerId) return [c, 'Personaggio non trovato'];
      const mods: AttackMods = {};
      const atkChar = c.characters[playerId] ?? Object.values(c.characters).find((ch) => ch.id === attackerId);
      if (atkChar) {
        if (exhaustionEffects(atkChar).disadvantageAttacksAndSaves) mods.disadvantage = true;
        if (hasAdvantage(atkChar, reg, 'attack')) mods.advantage = true;
        const dice = damageBonusDice(atkChar, reg).map((d) => d.dice);
        if (dice.length > 0) mods.extraDamageDice = dice;
      }
      c.combat = attack(c.combat, attackerId, action.targetId, action.attackIndex ?? 0, mods);
      return [c];
    }

    case 'move': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      const id = isMaster && cur ? cur.id : c.characters[playerId]?.id;
      if (!id) return [c, 'Personaggio non trovato'];
      c.combat = moveCombatant(c.combat, id, action.amount);
      return [c];
    }

    case 'useBonus':
    case 'useReaction': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      const id = isMaster && cur ? cur.id : c.characters[playerId]?.id;
      if (!id) return [c, 'Personaggio non trovato'];
      c.combat = action.kind === 'useBonus' ? useBonus(c.combat, id) : useReaction(c.combat, id);
      return [c];
    }

    case 'setCondition': {
      if (!isMaster) return [c, 'Solo il master può gestire le condizioni'];
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      c.combat = setCombatantCondition(c.combat, action.targetId, action.conditionId, action.on, action.rounds ?? 1);
      return [c];
    }

    case 'damage':
    case 'heal': {
      if (!isMaster) return [c, 'Solo il master può modificare i PF direttamente'];
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      c.combat = action.kind === 'damage' ? damageCombatant(c.combat, action.targetId, action.amount) : healCombatant(c.combat, action.targetId, action.amount);
      return [c];
    }

    case 'nextTurn': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      c.combat = nextTurn(c.combat);
      return [c];
    }

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
      return [c];
    }

    case 'dropConcentration': {
      const ch = c.characters[playerId];
      if (ch) c.characters[playerId] = { ...ch, concentrationSpellId: undefined, updatedAt: new Date().toISOString() };
      if (c.combat) {
        c.combat = {
          ...c.combat,
          combatants: c.combat.combatants.map((cb) => (ch && cb.id === ch.id ? { ...cb, concentrating: undefined } : cb)),
        };
      }
      return [c];
    }

    case 'masterAddXpAll': {
      if (!isMaster) return [c, 'Solo il master può dare XP a tutta la party'];
      for (const pid of Object.keys(c.characters)) {
        c.characters[pid] = addXp(c.characters[pid], action.amount);
      }
      return [c];
    }

    case 'groupAddItem': {
      const item: InventoryItem = {
        id: uid('grp'),
        name: action.item.name,
        kind: 'treasure',
        quantity: Math.max(1, action.item.quantity ?? 1),
        weight: action.item.weight ?? 0,
        equipped: false,
        magic: action.item.magic ?? false,
        attuned: false,
        valueGp: action.item.valueGp,
        rarity: action.item.rarity,
        spellId: action.item.spellId,
      };
      c.groupInventory = [...c.groupInventory, item];
      if (c.combat) c.combat.log = [...c.combat.log, `🎒 ${player.name} aggiunge al gruppo: ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}.`];
      return [c];
    }

    case 'groupRemoveItem': {
      if (!isMaster) return [c, 'Solo il master può rimuovere oggetti dal gruppo'];
      c.groupInventory = c.groupInventory.filter((i) => i.id !== action.itemId);
      return [c];
    }

    case 'groupGiveItem': {
      if (!isMaster) return [c, 'Solo il master può assegnare oggetti ai giocatori'];
      const item = c.groupInventory.find((i) => i.id === action.itemId);
      const target = c.characters[action.playerId];
      if (!item || !target) return [c, 'Oggetto o giocatore non trovato'];
      c.groupInventory = c.groupInventory.filter((i) => i.id !== action.itemId);
      const r = addItem(target, { ...item, id: undefined });
      c.characters[action.playerId] = r.character;
      return [c];
    }

    case 'groupAddCurrency': {
      if (!isMaster) return [c, 'Solo il master può modificare la tesoreria di gruppo'];
      c.groupCurrency = addCurrencyRaw(c.groupCurrency, action.amount);
      return [c];
    }

    case 'setTemplate': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      c.combat = setTemplate(c.combat, action.template);
      return [c];
    }

    case 'clearTemplate': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      if (!isMaster && !isTurn) return [c, 'Non è il tuo turno'];
      c.combat = clearTemplate(c.combat);
      return [c];
    }

    case 'setCampaignNote': {
      if (!isMaster) return [c, 'Solo il master può modificare le note di sessione'];
      c.notes = action.text;
      return [c];
    }

    case 'moveToken': {
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      // master sempre; un PG può muovere il proprio token solo nel suo turno
      const ownTurn = cur !== undefined && cur.id === action.targetId && isTurn;
      if (!isMaster && !ownTurn) return [c, 'Puoi muovere solo il tuo token nel tuo turno (o sei il master)'];
      if (!c.combat.combatants.some((x) => x.id === action.targetId)) return [c, 'Combattente non trovato'];
      c.combat = moveToken(ensureMap(c.combat), action.targetId, action.x, action.y);
      return [c];
    }

    case 'setMapSize': {
      if (!isMaster) return [c, 'Solo il master può ridimensionare la mappa'];
      if (!c.combat) return [c, 'Nessun combattimento in corso'];
      c.combat = setMapSize(ensureMap(c.combat), action.cols, action.rows);
      return [c];
    }

    case 'saveCharacter':
    case 'deleteCharacter':
    case 'useCharacter':
    case 'deleteCampaign':
      // gestite dal chiamante (server: account su disco / file; host P2P: in memoria)
      return [c, 'Azione gestita dal chiamante: ' + action.kind];

    default:
      return [c, 'Azione sconosciuta: ' + (action as { kind: string }).kind];
  }
}
