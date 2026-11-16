import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createRegistry,
  loadData,
  type Character,
  type Registry,
  type SrdData,
} from '@dnd5e/core';
import { SRD_DATA, createSrdRegistry } from '@dnd5e/data-srd';

const CHAR_KEY = 'dnd5e.character.v1';
const CUSTOM_KEY = 'dnd5e.custom.v1';

function loadStoredCharacter(): Character | null {
  try {
    const raw = localStorage.getItem(CHAR_KEY);
    return raw ? (JSON.parse(raw) as Character) : null;
  } catch {
    return null;
  }
}

interface Store {
  reg: Registry;
  char: Character | null;
  setChar: (c: Character | null) => void;
  resetChar: () => void;
  reloadCustom: () => void;
  customCount: number;
}

const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const reg = useMemo<Registry>(() => {
    const r = createSrdRegistry();
    return r;
  }, []);

  const [char, setCharState] = useState<Character | null>(() => loadStoredCharacter());
  const [customCount, setCustomCount] = useState(0);

  const loadCustom = () => {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as SrdData;
      const fresh = createRegistry();
      loadData(fresh, SRD_DATA);
      loadData(fresh, data);
      // sostituisce il registry mantenendo il personaggio
      (reg as unknown as Registry) && Object.assign(reg.classes, fresh.classes);
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
    } catch {
      /* ignora custom corrotti */
    }
  };

  useEffect(() => {
    loadCustom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setChar = (c: Character | null) => {
    setCharState(c);
    if (c) localStorage.setItem(CHAR_KEY, JSON.stringify(c));
    else localStorage.removeItem(CHAR_KEY);
  };

  const value: Store = {
    reg,
    char,
    setChar,
    resetChar: () => setChar(null),
    reloadCustom: loadCustom,
    customCount,
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore fuori dal provider');
  return ctx;
}

export function persistCustom(data: SrdData): void {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(data));
}
