import { createRegistry, loadData, type Registry, type SrdData } from '@dnd5e/core';
import { SRD_DATA } from '@dnd5e/data-srd';
import { loadJSON, saveJSON } from './storage.js';

/**
 * Editor regole base (SRD): strato di OVERRIDE persistente in localStorage, applicato
 * sopra a SRD_DATA quando si costruisce il registry (loadData sovrascrive per id).
 * Permette di rifinire testi/nomi delle regole base senza toccare i JSON del pacchetto;
 * esportabile/importabile come JSON (utile per portarlo su un altro dispositivo o come base
 * per un .5epack custom da caricare in campagna).
 */
export const SRD_OVERRIDES_KEY = 'dnd5e.srd.overrides.v1';

export type OverrideCategory =
  | 'classes' | 'subclasses' | 'races' | 'spells' | 'weapons' | 'armors' | 'feats' | 'fightingStyles' | 'enemies';

export const OVERRIDE_CATEGORIES: { id: OverrideCategory; label: string }[] = [
  { id: 'spells', label: 'Incantesimi' },
  { id: 'weapons', label: 'Armi' },
  { id: 'armors', label: 'Armature' },
  { id: 'enemies', label: 'Nemici' },
  { id: 'feats', label: 'Talenti' },
  { id: 'fightingStyles', label: 'Stili di combattimento' },
  { id: 'races', label: 'Razze' },
  { id: 'classes', label: 'Classi' },
  { id: 'subclasses', label: 'Sottoclassi' },
];

export type SrdOverrides = Partial<Record<OverrideCategory, Record<string, Record<string, unknown>>>>;

export async function loadOverrides(): Promise<SrdOverrides> {
  try {
    const v = await loadJSON<SrdOverrides>(SRD_OVERRIDES_KEY);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* corroto: si riparte da vuoto */ }
  return {};
}

export function saveOverrides(o: SrdOverrides): Promise<boolean> {
  return saveJSON(SRD_OVERRIDES_KEY, o);
}

export function countOverrides(o: SrdOverrides): number {
  return OVERRIDE_CATEGORIES.reduce((n, c) => n + Object.keys(o[c.id] ?? {}).length, 0);
}

/** inserisce/aggiorna un elemento (per id) nella categoria */
export function upsertOverride(o: SrdOverrides, cat: OverrideCategory, entry: Record<string, unknown>): SrdOverrides {
  const id = String(entry.id ?? '');
  if (!id) throw new Error('id mancante');
  const next: SrdOverrides = { ...o, [cat]: { ...(o[cat] ?? {}), [id]: entry } };
  return next;
}

export function removeOverride(o: SrdOverrides, cat: OverrideCategory, id: string): SrdOverrides {
  const catMap = { ...(o[cat] ?? {}) };
  delete catMap[id];
  return { ...o, [cat]: catMap };
}

/** materializza gli override come SrdData completo (array vuoti dove non ci sono override) */
export function materializeOverrides(o: SrdOverrides): SrdData {
  const empty = { classes: [], subclasses: [], races: [], spells: [], weapons: [], armors: [], feats: [], fightingStyles: [], enemies: [] } as unknown as SrdData;
  const out = { ...empty };
  for (const c of OVERRIDE_CATEGORIES) {
    out[c.id] = Object.values(o[c.id] ?? {}) as never;
  }
  return out;
}

/** valida un elemento: deve essere JSON valido, con id, e caricabile sopra l'SRD senza errori */
export function validateOverrideEntry(cat: OverrideCategory, entry: Record<string, unknown>): string | null {
  if (!entry || typeof entry !== 'object') return 'non è un oggetto';
  if (!String(entry.id ?? '').trim()) return 'campo "id" mancante';
  try {
    const tmp = createRegistry();
    loadData(tmp, SRD_DATA);
    loadData(tmp, materializeOverrides({ [cat]: { [String(entry.id)]: entry } }));
  } catch (e) {
    return 'caricamento fallito: ' + (e as Error).message;
  }
  return null;
}

/** applica gli override al registry (dopo l'SRD: loadData sovrascrive per id) */
export function applyOverridesToRegistry(reg: Registry, o: SrdOverrides): void {
  if (countOverrides(o) > 0) loadData(reg, materializeOverrides(o));
}

export function exportOverrides(o: SrdOverrides): string {
  return JSON.stringify({ app: '5emanager', kind: 'srd-overrides', v: 1, overrides: o }, null, 2);
}

/** importa override da JSON (formato exportOverrides o un semplice {categoria: [entry...]}); ritorna errore o numero importati */
export function importOverrides(json: string): { error: string | null; count: number; data: SrdOverrides | null } {
  let j: unknown;
  try { j = JSON.parse(json); } catch (e) { return { error: 'JSON non valido: ' + (e as Error).message, count: 0, data: null }; }
  const raw = (j as { overrides?: unknown })?.overrides ?? j;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'formato non riconosciuto', count: 0, data: null };
  const next: SrdOverrides = {};
  let count = 0;
  for (const c of OVERRIDE_CATEGORIES) {
    const v = (raw as Record<string, unknown>)[c.id];
    if (!v) continue;
    const arr = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      const id = String((entry as { id?: unknown }).id ?? '');
      if (!id) continue;
      next[c.id] = { ...(next[c.id] ?? {}), [id]: entry as Record<string, unknown> };
      count++;
    }
  }
  return { error: null, count, data: next };
}
