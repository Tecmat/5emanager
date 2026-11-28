import type { Character } from '@dnd5e/core';
import { loadJSON, saveJSON } from './storage.js';

/**
 * Versionamento delle schede: snapshot persistenti (IndexedDB/localStorage) per scheda,
 * oltre all'undo in memoria dello store. Cap 20 versioni per scheda (le più vecchie vengono scartate).
 * Le versioni "auto" vengono create dallo store al massimo una volta ogni ora di modifiche;
 * quelle manuali dall'utente ("Salva versione") e prima del level-up.
 */

export interface SheetVersion {
  at: string; // ISO
  label: string;
  character: Character;
}

const KEY = 'dnd5e.sheetVersions.v1';
const MAX_PER_SHEET = 20;

type AllVersions = Record<string, SheetVersion[]>;

async function loadAll(): Promise<AllVersions> {
  try {
    return (await loadJSON<AllVersions>(KEY)) ?? {};
  } catch {
    return {};
  }
}

/** lista delle versioni di una scheda, dalla più recente */
export async function listVersions(sheetId: string): Promise<SheetVersion[]> {
  const all = await loadAll();
  return (all[sheetId] ?? []).slice().sort((a, b) => b.at.localeCompare(a.at));
}

/** salva una versione (cap 20 per scheda) e ritorna la lista aggiornata */
export async function saveVersion(sheetId: string, character: Character, label: string): Promise<SheetVersion[]> {
  const all = await loadAll();
  const v: SheetVersion = { at: new Date().toISOString(), label, character };
  const list = [...(all[sheetId] ?? []), v].slice(-MAX_PER_SHEET);
  all[sheetId] = list;
  saveJSON(KEY, all);
  return list.slice().sort((a, b) => b.at.localeCompare(a.at));
}

export async function deleteVersion(sheetId: string, at: string): Promise<void> {
  const all = await loadAll();
  all[sheetId] = (all[sheetId] ?? []).filter((v) => v.at !== at);
  saveJSON(KEY, all);
}

/** elimina tutte le versioni di una scheda (quando la scheda viene eliminata) */
export async function clearVersions(sheetId: string): Promise<void> {
  const all = await loadAll();
  if (all[sheetId]) {
    delete all[sheetId];
    saveJSON(KEY, all);
  }
}
