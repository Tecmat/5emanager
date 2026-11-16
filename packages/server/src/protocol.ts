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
  | { kind: 'leave' };

export type ServerMessage =
  | { t: 'welcome'; you: PlayerInfo; campaign: Campaign }
  | { t: 'campaigns'; list: { id: string; name: string; players: number }[] }
  | { t: 'state'; campaign: Campaign }
  | { t: 'error'; message: string };
