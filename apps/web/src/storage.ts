import { idbGet, idbSet } from './idb.js';

/**
 * Storage ibrido: IndexedDB come primario (molto più capiente di localStorage,
 * ideale per i ritratti), localStorage come fallback e per la migrazione.
 * - loadJSON: legge da IDB; se manca, da localStorage (e lo copia in IDB)
 * - saveJSON: scrive su IDB; se fallisce (quota/privacy), ripiega su localStorage
 */

export async function loadJSON<T>(key: string): Promise<T | undefined> {
  try {
    const v = await idbGet<T>(key);
    if (v !== undefined) return v;
  } catch { /* IDB non disponibile: uso localStorage */ }
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;
    const parsed = JSON.parse(raw) as T;
    // migra in IDB (best effort)
    try { await idbSet(key, parsed); } catch { /* ignora */ }
    return parsed;
  } catch {
    return undefined;
  }
}

/** ritorna true se il valore è finito su IndexedDB */
export async function saveJSON(key: string, value: unknown): Promise<boolean> {
  try {
    await idbSet(key, value);
    return true;
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return false;
    } catch {
      return false;
    }
  }
}
