import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { getLang, storeLang, t as translate, type Lang } from './i18n.js';

const SHEETS_KEY = 'dnd5e.sheets.v2';
const LEGACY_CHAR_KEY = 'dnd5e.character.v1';
export const CUSTOM_KEY = 'dnd5e.custom.v1';

interface SheetStoreData {
  activeId: string | null;
  sheets: Record<string, Character>;
}

function migrateSheets(data: SheetStoreData): SheetStoreData {
  const sheets: Record<string, Character> = {};
  for (const [id, c] of Object.entries(data.sheets ?? {})) sheets[id] = migrateCharacter(c);
  return { activeId: data.activeId ?? null, sheets };
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
  return { activeId: null, sheets: {} };
}

interface Store {
  reg: Registry;
  char: Character | null;
  sheets: Character[];
  setChar: (c: Character) => void;
  createSheet: (c: Character) => void;
  importSheets: (list: Character[]) => void;
  selectSheet: (id: string | null) => void;
  deleteSheet: (id: string) => void;
  resetChar: () => void;
  reloadCustom: () => void;
  customCount: number;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, fallback?: string) => string;
}

const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const reg = useMemo<Registry>(() => {
    return createSrdRegistry();
  }, []);

  const [data, setData] = useState<SheetStoreData>({ activeId: null, sheets: {} });
  const [customCount, setCustomCount] = useState(0);
  const [lang, setLangState] = useState<Lang>(getLang);

  useEffect(() => {
    loadSheetsAsync().then(setData);
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

  const char = (data.activeId && data.sheets[data.activeId]) || null;

  const sheets = useMemo(
    () => Object.values(data.sheets).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
    [data],
  );

  const setChar = (c: Character) => {
    if (!data.activeId) return;
    persist({ ...data, sheets: { ...data.sheets, [data.activeId]: c } });
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
    char,
    sheets,
    setChar,
    createSheet,
    importSheets,
    selectSheet,
    deleteSheet,
    resetChar: () => { if (data.activeId) deleteSheet(data.activeId); },
    reloadCustom: loadCustom,
    customCount,
    lang,
    setLang: (l: Lang) => { storeLang(l); setLangState(l); },
    t: (key: string, fallback?: string) => translate(lang, key, fallback),
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
