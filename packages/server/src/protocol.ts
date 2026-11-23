import type { Campaign, Character, ClientAction, PlayerInfo, SavedCampaignSnapshot, SrdData } from '@dnd5e/core';

export type { Campaign, PlayerInfo, ClientAction } from '@dnd5e/core';

export type ClientMessage =
  | { t: 'create'; name: string; password: string; campaignName: string; playerToken?: string }
  | { t: 'join'; campaignId: string; password: string; name: string; role?: 'master' | 'player'; playerToken?: string }
  | { t: 'list' }
  // account: register crea una RICHIESTA che l'admin approva; login verifica la password lato server (hash sha256)
  | { t: 'register'; username: string; password: string }
  | { t: 'login'; username: string; password: string; remember?: boolean }
  /** login automatico con token "mantieni l'accesso" (persistito dal client) */
  | { t: 'loginToken'; token: string; remember?: boolean }
  // 2FA TOTP: login in due passi (password -> totpRequired -> loginTotp/loginTotpBackup)
  | { t: 'loginTotp'; username: string; password: string; code: string; remember?: boolean }
  | { t: 'loginTotpBackup'; username: string; password: string; backupCode: string; remember?: boolean }
  // gestione 2FA (richiede login): setupTotp genera secret+QR+codici backup, enableTotp conferma col codice
  | { t: 'setupTotp' }
  | { t: 'enableTotp'; code: string }
  | { t: 'disableTotp'; password: string }
  // passkey WebAuthn: register* richiede login; login* e' passwordless (username opzionale = discoverable)
  | { t: 'passkeyRegisterStart' }
  | { t: 'passkeyRegisterFinish'; response: unknown }
  | { t: 'passkeyLoginStart'; username?: string }
  | { t: 'passkeyLoginFinish'; username?: string; response: unknown }
  | { t: 'passkeyList' }
  | { t: 'passkeyRemove'; credentialId: string }
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
  | { t: 'adminSetRole'; username: string; role: 'admin' | 'user' }
  /** l'admin sceglie se la registrazione e' aperta (open) o con approvazione (approval) */
  | { t: 'adminSetRegistration'; mode: 'open' | 'approval' }
  | { t: 'adminResetPassword'; username: string; password: string }
  | { t: 'adminDisableTotp'; username: string }
  | { t: 'adminClearPasskeys'; username: string }
  | { t: 'adminCampaignDetail'; id: string }
  | { t: 'adminKickPlayer'; campaignId: string; playerId: string }
  | { t: 'adminBroadcast'; message: string }
  | { t: 'action'; action: ClientAction }
  // discovery P2P: gli host P2P si annunciano qui (relay di codici SDP e, se WebRTC manca, di tutto il traffico)
  | { t: 'p2pAnnounce'; name: string }
  | { t: 'p2pList' }
  | { t: 'p2pJoin'; hostId: string; name?: string; password?: string; playerToken?: string }
  // codice invito BREVE (XXXX-XXXX): l'host lo annuncia e il giocatore lo usa al posto dell'hostId
  | { t: 'p2pAnnounceCode'; code: string; name?: string }
  | { t: 'p2pJoinCode'; code: string; name?: string; password?: string; playerToken?: string }
  | { t: 'p2pOffer'; to: string; code: string }
  | { t: 'p2pAnswer'; to: string; code: string }
  | { t: 'p2pData'; to: string; data: string };


export type ServerMessage =
  | { t: 'welcome'; you: PlayerInfo; campaign: Campaign }
  | { t: 'campaigns'; list: { id: string; name: string; players: number }[] }
  | { t: 'state'; campaign: Campaign }
  | { t: 'auth'; token: string; username: string; role: 'admin' | 'user'; characters: Character[]; savedCampaigns: SavedCampaignSnapshot[]; totpEnabled: boolean; /** token persistente per "mantieni l'accesso" (presente solo se richiesto) */ rememberToken?: string }
  | { t: 'totpRequired'; username: string }
  | { t: 'totpSetup'; secret: string; otpauthUrl: string; backupCodes: string[] }
  | { t: 'passkeyRegisterOptions'; options: unknown }
  | { t: 'passkeyLoginOptions'; options: unknown }
  | { t: 'passkeyList'; passkeys: { id: string; name: string; createdAt: string; deviceType?: string; backedUp?: boolean }[] }
  | { t: 'pong'; id: string; serverTime: number }
  | {
      t: 'adminState';
      campaigns: { id: string; name: string; players: number; inCombat: boolean; characters: number; createdAt: string; updatedAt: string }[];
      accounts: { username: string; role: 'admin' | 'user'; characters: number; createdAt: string; lastLoginAt?: string; loginCount?: number; totp: boolean; passkeys: number; p2p: number }[];
      pending: { username: string; requestedAt: string }[];
      server: { startedAt: string; uptimeSec: number; campaigns: number; accounts: number; pending: number; characters: number; p2pCampaigns: number; lan: string[]; requireAuth: boolean; registration: 'open' | 'approval' };
    }
  | { t: 'adminAccount'; username: string; characters: { id: string; name: string; level: number; updatedAt: string }[] }
  | { t: 'adminCampaign'; id: string; name: string; players: PlayerInfo[]; characters: number; inCombat: boolean; createdAt: string; updatedAt: string }
  | { t: 'kicked' }
  | { t: 'joinPending' }
  /** ack al giocatore: la sua richiesta di join è stata inoltrata all'host (è in attesa di approvazione) */
  | { t: 'p2pJoinSent' }
  | { t: 'notice'; message: string }
  | { t: 'campaignDeleted'; id: string }
  | { t: 'p2pHosts'; hosts: { id: string; name: string; ip?: string }[] }
  | { t: 'p2pCodeHost'; hostId: string; name?: string }
  | { t: 'p2pJoinRequest'; from: string; name?: string; password?: string; playerToken?: string }
  /** relay host: un peer il cui socket si è chiuso (connId) — l'host lo marca offline con grace period */
  | { t: 'p2pPeerGone'; from: string }
  | { t: 'p2pOffer'; from: string; name: string; code: string }
  | { t: 'p2pAnswer'; from: string; code: string }
  | { t: 'p2pData'; from: string; data: string }
  | { t: 'error'; message: string };
