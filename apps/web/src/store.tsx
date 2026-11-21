import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createRegistry,
  loadData,
  migrateCharacter,
  type Character,
  type Registry,
  type SrdData,
} from '@dnd5e/core';
import { SRD_DATA, createSrdRegistry } from '@dnd5e/data-srd';
import { loadJSON, saveJSON } from './storage.js';
import { getLang, storeLang, t as translate, tf as translateF, type Lang } from './i18n.js';

const SHEETS_KEY = 'dnd5e.sheets.v2';
const LEGACY_CHAR_KEY = 'dnd5e.character.v1';
export const CUSTOM_KEY = 'dnd5e.custom.v1';

/** id della scheda "di campagna": separata da quella locale, così il multigiocatore non la tocca */
export function campaignSheetId(campaignId: string): string {
  return `campagna:${campaignId}`;
}
export function isCampaignSheetId(id: string): boolean {
  return id.startsWith('campagna:');
}

interface SheetStoreData {
  activeId: string | null;
  sheets: Record<string, Character>;
  /** nome/ultima connessione delle campagne viste: campaignId -> { name, server? } */
  campaignMeta?: Record<string, { name: string; server?: string }>;
}

function migrateSheets(data: SheetStoreData): SheetStoreData {
  const sheets: Record<string, Character> = {};
  for (const [id, c] of Object.entries(data.sheets ?? {})) sheets[id] = migrateCharacter(c);
  // se la scheda attiva manca (o non è mai stata impostata), seleziona la più recente:
  // così le tab di scheda non restano mai bloccate a vuoto
  let activeId = data.activeId ?? null;
  if (!activeId || !sheets[activeId]) {
    const rest = Object.values(sheets).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    activeId = rest[0]?.id ?? null;
  }
  return { activeId, sheets, campaignMeta: data.campaignMeta ?? {} };
}

/** carica le schede da IndexedDB (fallback localStorage) e migra dalla v1 */
async function loadSheetsAsync(): Promise<SheetStoreData> {
  const stored = await loadJSON<SheetStoreData>(SHEETS_KEY);
  if (stored && stored.sheets) return migrateSheets(stored);
  try {
    const legacy = localStorage.getItem(LEGACY_CHAR_KEY);
    if (legacy) {
      const c = migrateCharacter(JSON.parse(legacy) as Character);
      const d: SheetStoreData = { activeId: c.id, sheets: { [c.id]: c } };
      saveJSON(SHEETS_KEY, d);
      localStorage.removeItem(LEGACY_CHAR_KEY);
      return d;
    }
  } catch { /* ignora */ }
  return { activeId: null, sheets: {}, campaignMeta: {} };
}

interface Store {
  reg: Registry;
  /** true quando le schede sono state caricate da IndexedDB (per skeleton di caricamento) */
  ready: boolean;
  /** personaggio "in vista" (es. scheda di un giocatore vista dal master): se impostato, char punterà a lui */
  viewChar: Character | null;
  viewLabel: string | null;
  setViewChar: (c: Character | null, label?: string | null) => void;
  char: Character | null;
  sheets: Character[];
  setChar: (c: Character) => void;
  createSheet: (c: Character) => void;
  importSheets: (list: Character[]) => void;
  selectSheet: (id: string | null) => void;
  deleteSheet: (id: string) => void;
  resetChar: () => void;
  /** scheda dedicata a una campagna (id 'campagna:<id>'): null se non esiste ancora */
  getCampaignSheet: (campaignId: string) => Character | null;
  /** crea/aggiorna la scheda di campagna (copia separata: la locale resta intacta) */
  setCampaignSheet: (campaignId: string, c: Character | null) => void;
  campaignMeta: Record<string, { name: string; server?: string }>;
  setCampaignMeta: (campaignId: string, meta: { name: string; server?: string }) => void;
  reloadCustom: () => void;
  customCount: number;
  /** annulla l'ultima modifica alla scheda attiva (snapshot in memoria, max 30) */
  undo: () => void;
  canUndo: boolean;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, fallback?: string) => string;
  tf: (key: string, fallback: string, vars: Record<string, string | number>) => string;
}

const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const reg = useMemo<Registry>(() => {
    return createSrdRegistry();
  }, []);

  const [data, setData] = useState<SheetStoreData>({ activeId: null, sheets: {}, campaignMeta: {} });
  const [ready, setReady] = useState(false);
  const [customCount, setCustomCount] = useState(0);
  const [lang, setLangState] = useState<Lang>(getLang);

  useEffect(() => {
    loadSheetsAsync().then((d) => {
      setData(d);
      setReady(true);
    });
  }, []);

  const persist = (d: SheetStoreData) => {
    setData(d);
    saveJSON(SHEETS_KEY, d)
      .then((ok) => { if (!ok) alert("Archiviazione piena: il ritratto è troppo grande? Riprova con un'immagine più piccola."); })
      .catch(() => {});
  };

  const loadCustom = () => {
    loadJSON<SrdData>(CUSTOM_KEY).then((stored) => {
      if (!stored) return;
      const data = stored;
      const fresh = createRegistry();
      loadData(fresh, SRD_DATA);
      loadData(fresh, data);
      for (const [k, v] of fresh.classes) reg.classes.set(k, v);
      for (const [k, v] of fresh.subclasses) reg.subclasses.set(k, v);
      for (const [k, v] of fresh.races) reg.races.set(k, v);
      for (const [k, v] of fresh.spells) reg.spells.set(k, v);
      for (const [k, v] of fresh.weapons) reg.weapons.set(k, v);
      for (const [k, v] of fresh.armors) reg.armors.set(k, v);
      for (const [k, v] of fresh.feats) reg.feats.set(k, v);
      setCustomCount(
        fresh.spells.size + fresh.weapons.size + fresh.armors.size + fresh.classes.size +
        fresh.subclasses.size + fresh.races.size + fresh.feats.size -
        (SRD_DATA.spells.length + SRD_DATA.weapons.length + SRD_DATA.armors.length + SRD_DATA.classes.length +
          SRD_DATA.subclasses.length + SRD_DATA.races.length + SRD_DATA.feats.length),
      );
    }).catch(() => { /* ignora custom corrotti */ });
  };

  useEffect(() => {
    loadCustom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [viewChar, setViewCharState] = useState<Character | null>(null);
  const [viewLabel, setViewLabel] = useState<string | null>(null);
  const histRef = useRef<Character[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const setViewChar = (c: Character | null, label?: string | null) => {
    setViewCharState(c);
    setViewLabel(c ? (label ?? c.name) : null);
  };

  const ownChar = (data.activeId && data.sheets[data.activeId]) || null;
  // in modalità vista (master che guarda un giocatore) char è la scheda vista, in sola lettura
  const char = viewChar ?? ownChar;

  const sheets = useMemo(
    () => Object.values(data.sheets).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
    [data],
  );

  const setChar = (c: Character) => {
    if (viewChar) return; // sola lettura in modalità vista
    if (!data.activeId) return;
    const prev = data.sheets[data.activeId];
    if (prev && prev !== c) {
      histRef.current = [...histRef.current.slice(-29), prev];
      setCanUndo(true);
    }
    persist({ ...data, sheets: { ...data.sheets, [data.activeId]: c } });
  };

  const undo = () => {
    if (!data.activeId) return;
    const prev = histRef.current.pop();
    if (!prev) return;
    setCanUndo(histRef.current.length > 0);
    persist({ ...data, sheets: { ...data.sheets, [data.activeId]: prev } });
  };

  const createSheet = (c: Character) => {
    persist({ activeId: c.id, sheets: { ...data.sheets, [c.id]: c } });
  };

  /** importa una lista di schede (merge per id) */
  const importSheets = (list: Character[]) => {
    const sheets = { ...data.sheets };
    for (const c of list) sheets[c.id] = migrateCharacter(c);
    persist({ activeId: data.activeId ?? list[0]?.id ?? null, sheets });
  };

  const selectSheet = (id: string | null) => {
    persist({ ...data, activeId: id });
  };

  const getCampaignSheet = (campaignId: string): Character | null => data.sheets[campaignSheetId(campaignId)] ?? null;

  const setCampaignSheet = (campaignId: string, c: Character | null) => {
    const id = campaignSheetId(campaignId);
    const sheets = { ...data.sheets };
    if (c) sheets[id] = { ...c, id };
    else delete sheets[id];
    persist({ ...data, sheets });
  };

  const setCampaignMeta = (campaignId: string, meta: { name: string; server?: string }) => {
    persist({ ...data, campaignMeta: { ...(data.campaignMeta ?? {}), [campaignId]: meta } });
  };

  const deleteSheet = (id: string) => {
    const nextSheets = { ...data.sheets };
    delete nextSheets[id];
    let activeId = data.activeId;
    if (activeId === id) {
      const rest = Object.values(nextSheets).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
      activeId = rest[0]?.id ?? null;
    }
    persist({ activeId, sheets: nextSheets });
  };

  const value: Store = {
    reg,
    ready,
    viewChar,
    viewLabel,
    setViewChar,
    char,
    sheets,
    setChar,
    createSheet,
    importSheets,
    selectSheet,
    deleteSheet,
    resetChar: () => { if (data.activeId) deleteSheet(data.activeId); },
    getCampaignSheet,
    setCampaignSheet,
    campaignMeta: data.campaignMeta ?? {},
    setCampaignMeta,
    reloadCustom: loadCustom,
    customCount,
    undo,
    canUndo,
    lang,
    setLang: (l: Lang) => { storeLang(l); setLangState(l); },
    t: (key: string, fallback?: string) => translate(lang, key, fallback),
    tf: (key: string, fallback: string, vars: Record<string, string | number>) => translateF(lang, key, fallback, vars),
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore fuori dal provider');
  return ctx;
}

export function persistCustom(data: SrdData): void {
  saveJSON(CUSTOM_KEY, data)
    .then((ok) => { if (!ok) alert('Archiviazione piena: salvataggio dei contenuti custom fallito.'); })
    .catch(() => {});
}
