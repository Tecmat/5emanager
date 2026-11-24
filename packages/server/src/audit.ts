import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ensureDataDir } from './campaign.js';

/**
 * Audit log del server: una riga JSON per evento (JSONL) su $DND5E_DATA_DIR/audit.log,
 * ruotato a .1 quando supera DND5E_AUDIT_MAX_BYTES (default 5 MB). MAI password/token nel log.
 * Lettura lato admin via WS `adminAudit` (pannello /admin, card "Audit log").
 */
export const AUDIT_FILE = process.env.DND5E_AUDIT_FILE ?? join(DATA_DIR, 'audit.log');
/** dimensione max di audit.log prima della rotazione su audit.log.1 (DND5E_AUDIT_MAX_BYTES, default 5 MB) */
function auditMaxBytes(): number {
  const n = Number(process.env.DND5E_AUDIT_MAX_BYTES ?? 5 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
}

export interface AuditEntry {
  at: string;
  /** username della sessione, 'admin-token', 'setup' oppure 'ip:<ip>' se non loggato */
  actor: string;
  action: string;
  detail?: string;
  ip?: string;
}

/** appende un evento (mai bloccante: un errore di log non deve fermare l'operazione) */
export function audit(actor: string, action: string, detail?: string, ip?: string): void {
  const e: AuditEntry = { at: new Date().toISOString(), actor, action, detail: detail?.slice(0, 300), ip };
  try {
    ensureDataDir();
    if (existsSync(AUDIT_FILE) && statSync(AUDIT_FILE).size > auditMaxBytes()) {
      renameSync(AUDIT_FILE, AUDIT_FILE + '.1');
    }
    appendFileSync(AUDIT_FILE, JSON.stringify(e) + '\n');
  } catch {
    /* log non disponibile: ignora */
  }
}

/** ultimi `limit` eventi, dal piu' recente (per il pannello admin) */
export function readAudit(limit = 100): AuditEntry[] {
  try {
    if (!existsSync(AUDIT_FILE)) return [];
    const lines = readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean);
    const out: AuditEntry[] = [];
    for (const l of lines.slice(-Math.max(1, limit))) {
      try { out.push(JSON.parse(l) as AuditEntry); } catch { /* riga corrotta: salta */ }
    }
    return out.reverse();
  } catch {
    return [];
  }
}
