import type { Character, CombatState, HouseRules, SrdData } from '@dnd5e/core';

export interface PlayerInfo {
  id: string;
  name: string;
  role: 'master' | 'player';
  characterId?: string;
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
  createdAt: string;
  updatedAt: string;
}

export type ClientMessage =
  | { t: 'create'; name: string; password: string; campaignName: string }
  | { t: 'join'; campaignId: string; password: string; name: string; role?: 'master' | 'player' }
  | { t: 'list' }
  // account: register crea una RICHIESTA che l'admin approva; login verifica la password lato server (hash sha256)
  | { t: 'register'; username: string; password: string }
  | { t: 'login'; username: string; password: string }
  | { t: 'ping'; id: string }
  // pannello admin del server (LAN): se DND5E_ADMIN_TOKEN e' impostato, adminAuth deve contenerlo
  | { t: 'adminAuth'; token: string }
  | { t: 'adminList' }
  | { t: 'adminCreateCampaign'; name: string; password: string }
  | { t: 'adminUpdateCampaign'; id: string; name?: string; password?: string }
  | { t: 'adminDeleteCampaign'; id: string }
  | { t: 'adminDeleteAccount'; username: string }
  | { t: 'adminApproveAccount'; username: string }
  | { t: 'adminRejectAccount'; username: string }
  | { t: 'adminAccountDetail'; username: string }
  | { t: 'adminDeleteCharacter'; username: string; characterId: string }
  | { t: 'action'; action: ClientAction };

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
  | { kind: 'saveCharacter'; character: Character }
  | { kind: 'deleteCharacter'; characterId: string }
  | { kind: 'useCharacter'; characterId: string }
  // pannello master: modificano la scheda del giocatore SENZA escribirlo nel log pubblico (segreto)
  | { kind: 'masterDamage'; playerId: string; amount: number }
  | { kind: 'masterHeal'; playerId: string; amount: number }
  | { kind: 'masterAddXp'; playerId: string; amount: number }
  | { kind: 'masterSetCondition'; playerId: string; conditionId: string; on: boolean }
  | { kind: 'deleteCampaign' };

export type ServerMessage =
  | { t: 'welcome'; you: PlayerInfo; campaign: Campaign }
  | { t: 'campaigns'; list: { id: string; name: string; players: number }[] }
  | { t: 'state'; campaign: Campaign }
  | { t: 'auth'; token: string; username: string; characters: Character[] }
  | { t: 'pong'; id: string; serverTime: number }
  | {
      t: 'adminState';
      campaigns: { id: string; name: string; players: number; inCombat: boolean; createdAt: string; updatedAt: string }[];
      accounts: { username: string; characters: number; createdAt: string }[];
      pending: { username: string; requestedAt: string }[];
      server: { startedAt: string; uptimeSec: number; campaigns: number; accounts: number; pending: number; lan: string[] };
    }
  | { t: 'adminAccount'; username: string; characters: { id: string; name: string; level: number; updatedAt: string }[] }
  | { t: 'notice'; message: string }
  | { t: 'campaignDeleted'; id: string }
  | { t: 'error'; message: string };
