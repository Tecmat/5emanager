import type { Campaign, SavedCampaignSnapshot } from '@dnd5e/core';
import { loadJSON, saveJSON } from './storage.js';

/**
 * Campagne P2P salvate in locale dall'host (IndexedDB, fallback localStorage).
 * Lo snapshot serve a "riprendere dalle sessioni scorse" senza server:
 * la campagna resta in memoria dell'host, ma una copia (senza password) resta qui.
 * La password NON viene mai salvata: va reinserita (facoltativa) al ripristino.
 * Le stesse snapshot si possono sincronizzare sull'account del server remoto
 * (azione saveP2PCampaign) e la tab "Campagne P2P" le gestisce.
 */

const KEY = 'dnd5e.p2p.saved.v1';
const MAX_SAVED = 20;

export type SavedP2PCampaign = SavedCampaignSnapshot;

type SavedMap = Record<string, SavedP2PCampaign>;

async function loadMap(): Promise<SavedMap> {
  return (await loadJSON<SavedMap>(KEY)) ?? {};
}

/** elenco campagne salvate, dalla più recente */
export async function listSavedP2P(): Promise<SavedP2PCampaign[]> {
  const m = await loadMap();
  return Object.values(m).sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
}

export async function getSavedP2P(id: string): Promise<SavedP2PCampaign | undefined> {
  return (await loadMap())[id];
}

/** upsert dello snapshot (senza password), con cap a MAX_SAVED (le più vecchie vengono scartate) */
export async function saveP2PCampaign(c: Campaign): Promise<void> {
  const m = await loadMap();
  m[c.id] = { id: c.id, name: c.name, savedAt: new Date().toISOString(), campaign: { ...c, passwordHash: '' } };
  const capped = Object.values(m).sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? '')).slice(0, MAX_SAVED);
  const next: SavedMap = {};
  for (const s of capped) next[s.id] = s;
  await saveJSON(KEY, next);
}

/** salva uno snapshot proveniente dal server (già senza password) in locale */
export async function importSavedP2P(s: SavedP2PCampaign): Promise<void> {
  const m = await loadMap();
  m[s.id] = { ...s, campaign: { ...s.campaign, passwordHash: '' } };
  const capped = Object.values(m).sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? '')).slice(0, MAX_SAVED);
  const next: SavedMap = {};
  for (const s2 of capped) next[s2.id] = s2;
  await saveJSON(KEY, next);
}

export async function deleteSavedP2P(id: string): Promise<void> {
  const m = await loadMap();
  if (m[id]) {
    delete m[id];
    await saveJSON(KEY, m);
  }
}

export async function renameSavedP2P(id: string, name: string): Promise<void> {
  const m = await loadMap();
  if (m[id]) {
    m[id].name = name;
    m[id].campaign = { ...m[id].campaign, name };
    await saveJSON(KEY, m);
  }
}

// --- segnale "riprendi questa campagna" dalla tab dedicata -> CampaignTab ---
let resumeListener: ((id: string) => void) | null = null;

export function onResumeRequest(fn: (id: string) => void): () => void {
  resumeListener = fn;
  return () => { resumeListener = null; };
}

export function requestResume(id: string): void {
  resumeListener?.(id);
}
