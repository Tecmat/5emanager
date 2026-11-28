import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ensureDataDir } from './campaign.js';

/**
 * Moderation log del server: eventi di moderazione (block/unblock/report/kick,
 * tentativi di join bloccati, ritratti sanificati) su $DND5E_DATA_DIR/moderation.log
 * (JSONL, ruotato a .1 oltre DND5E_MODERATION_MAX_BYTES, default 5 MB).
 *
 * Attivabile/disattivabile con DND5E_MODERATION_LOG (default '1' = attivo;
 * '0'/'false'/'off' = spento: gli eventi restano pero' nell'audit log generale).
 * MAI password/token nel log. Lettura lato admin via WS `adminModerationLog`.
 */
export const MODERATION_FILE = process.env.DND5E_MODERATION_FILE ?? join(DATA_DIR, 'moderation.log');

export function moderationEnabled(): boolean {
  const v = (process.env.DND5E_MODERATION_LOG ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

export interface ModerationEntry {
  at: string;
  /** username della sessione, 'admin-token', oppure 'ip:<ip>' / 'anon' se non loggato */
  actor: string;
  action: string;
  detail?: string;
  ip?: string;
}

function maxBytes(): number {
  const n = Number(process.env.DND5E_MODERATION_MAX_BYTES ?? 5 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
}

/** appende un evento di moderazione (solo se il log e' attivo; mai bloccante) */
export function moderationLog(actor: string, action: string, detail?: string, ip?: string): void {
  if (!moderationEnabled()) return;
  const e: ModerationEntry = { at: new Date().toISOString(), actor, action, detail: detail?.slice(0, 300), ip };
  try {
    ensureDataDir();
    if (existsSync(MODERATION_FILE) && statSync(MODERATION_FILE).size > maxBytes()) {
      renameSync(MODERATION_FILE, MODERATION_FILE + '.1');
    }
    appendFileSync(MODERATION_FILE, JSON.stringify(e) + '\n');
  } catch {
    /* log non disponibile: ignora */
  }
}

/** ultimi `limit` eventi, dal piu' recente (per il pannello admin) */
export function readModerationLog(limit = 100): ModerationEntry[] {
  try {
    if (!existsSync(MODERATION_FILE)) return [];
    const lines = readFileSync(MODERATION_FILE, 'utf8').split('\n').filter(Boolean);
    const out: ModerationEntry[] = [];
    for (const l of lines.slice(-Math.max(1, limit))) {
      try { out.push(JSON.parse(l) as ModerationEntry); } catch { /* riga corrotta: salta */ }
    }
    return out.reverse();
  } catch {
    return [];
  }
}
