import { useSyncExternalStore } from 'react';

/**
 * Impostazioni UI persistenti (localStorage `dnd5e.ui.v1`): tema, palette colori,
 * raggio angoli / stile bordi, set di icone e ordinamento/visibilità delle tab.
 * `applyUISettings` scrive le CSS variable su :root, quindi il tema si applica
 * a tutta l'app senza ricaricare.
 */

export type ThemePref = 'dark' | 'light' | 'auto';
export type IconSet = 'classic' | 'lucide';
export type BorderStyle = 'soft' | 'sharp' | 'pill';

export interface PaletteColors {
  accent: string;
  accent2: string;
}

export interface PalettePreset {
  id: string;
  nameKey: string;
  nameFb: string;
  dark: PaletteColors;
  light: PaletteColors;
}

/** palette predefinite (accento + accento secondario per tema scuro/chiaro) */
export const PALETTES: PalettePreset[] = [
  { id: 'gold', nameKey: 'ui.pal.gold', nameFb: 'Oro antico', dark: { accent: '#c9a227', accent2: '#8a6fd8' }, light: { accent: '#9a7a0c', accent2: '#5f43d6' } },
  { id: 'arcane', nameKey: 'ui.pal.arcane', nameFb: 'Violetto arcano', dark: { accent: '#a06cd5', accent2: '#d8a03f' }, light: { accent: '#7d3fc4', accent2: '#9a7a0c' } },
  { id: 'forest', nameKey: 'ui.pal.forest', nameFb: 'Foresta', dark: { accent: '#4caf7d', accent2: '#d8a03f' }, light: { accent: '#2e7d4f', accent2: '#9a7a0c' } },
  { id: 'blood', nameKey: 'ui.pal.blood', nameFb: 'Sangue', dark: { accent: '#d05a5a', accent2: '#8a6fd8' }, light: { accent: '#a82f2f', accent2: '#5f43d6' } },
  { id: 'ocean', nameKey: 'ui.pal.ocean', nameFb: 'Oceano', dark: { accent: '#4f9dd8', accent2: '#d8a03f' }, light: { accent: '#2273b8', accent2: '#9a7a0c' } },
  { id: 'mono', nameKey: 'ui.pal.mono', nameFb: 'Monocromatico', dark: { accent: '#b8b8c0', accent2: '#8a6fd8' }, light: { accent: '#55555e', accent2: '#5f43d6' } },
];

export interface UISettings {
  theme: ThemePref;
  /** id di PALETTES, oppure 'custom' quando l'utente sceglie i colori a mano */
  paletteId: string;
  /** accento personalizzato (usato in tema scuro; in chiaro viene scurito) */
  accent: string;
  accent2: string;
  /** raggio angoli 0-20 px (ignorato se border === 'sharp') */
  radius: number;
  border: BorderStyle;
  iconSet: IconSet;
  /** ordinamento tab principali (id delle pagine) */
  mainTabOrder: string[];
  mainTabHidden: string[];
  /** ordinamento tab interne della scheda */
  sheetTabOrder: string[];
  sheetTabHidden: string[];
}

export const UI_KEY = 'dnd5e.ui.v1';

export function defaultUISettings(): UISettings {
  let theme: ThemePref = 'auto';
  try {
    const t = localStorage.getItem('dnd5e-theme');
    if (t === 'light' || t === 'dark') theme = t;
  } catch { /* ignora */ }
  return {
    theme,
    paletteId: 'gold',
    accent: '#c9a227',
    accent2: '#8a6fd8',
    radius: 8,
    border: 'soft',
    iconSet: 'classic',
    mainTabOrder: [],
    mainTabHidden: [],
    sheetTabOrder: [],
    sheetTabHidden: [],
  };
}

export function loadUISettings(): UISettings {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return defaultUISettings();
    return { ...defaultUISettings(), ...(JSON.parse(raw) as Partial<UISettings>) };
  } catch {
    return defaultUISettings();
  }
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgba(hex: string, a: number): string {
  const c = hexToRgb(hex);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})` : hex;
}

/** scurisce un colore hex di una frazione f (0..1) */
export function darken(hex: string, f: number): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const d = (x: number) => Math.max(0, Math.round(x * (1 - f)));
  return `#${[d(c[0]), d(c[1]), d(c[2])].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function resolvedTheme(s: UISettings): 'dark' | 'light' {
  if (s.theme === 'auto') {
    try {
      return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch { return 'dark'; }
  }
  return s.theme;
}

/** applica le impostazioni scrivendo le CSS variable su :root e salvando su localStorage */
export function applyUISettings(s: UISettings): void {
  const root = document.documentElement;
  const theme = resolvedTheme(s);
  root.dataset.theme = theme;
  try { localStorage.setItem('dnd5e-theme', theme); } catch { /* quota */ }
  const pal = s.paletteId === 'custom' ? null : (PALETTES.find((p) => p.id === s.paletteId) ?? PALETTES[0]);
  const accent = theme === 'light' ? (pal?.light.accent ?? darken(s.accent, 0.3)) : (pal?.dark.accent ?? s.accent);
  const accent2 = theme === 'light' ? (pal?.light.accent2 ?? darken(s.accent2, 0.15)) : (pal?.dark.accent2 ?? s.accent2);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent2', accent2);
  root.style.setProperty('--accent-dim', rgba(accent, 0.5));
  root.style.setProperty('--stripe', rgba(accent, 0.05));
  root.style.setProperty('--gridline', rgba(accent, 0.06));
  const r = s.border === 'sharp' ? 2 : Math.max(0, Math.min(20, Math.round(s.radius)));
  root.style.setProperty('--radius', `${r}px`);
  root.style.setProperty('--btn-radius', s.border === 'pill' ? '999px' : `${r}px`);
  root.style.setProperty('--tag-radius', s.border === 'pill' ? '999px' : s.border === 'sharp' ? '4px' : '20px');
  root.dataset.border = s.border;
  root.dataset.iconSet = s.iconSet;
  try { localStorage.setItem(UI_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

let current = loadUISettings();
const listeners = new Set<() => void>();

export function getUISettings(): UISettings {
  return current;
}

export function updateUISettings(patch: Partial<UISettings>): void {
  current = { ...current, ...patch };
  applyUISettings(current);
  for (const l of listeners) l();
}

export function subscribeUISettings(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useUISettings(): UISettings {
  return useSyncExternalStore(subscribeUISettings, getUISettings);
}

/** ordina una lista di tab secondo `order` (id sconosciuti in coda, ordine originale) e filtra le nascoste */
export function orderTabs<T extends { id: string }>(items: T[], order: string[], hidden: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const sorted = [...items].sort((a, b) => (rank.get(a.id) ?? 999 + items.indexOf(a)) - (rank.get(b.id) ?? 999 + items.indexOf(b)));
  return sorted.filter((t) => !hidden.includes(t.id));
}

/** sposta un id in su/giù nell'array di ordinamento */
export function moveId(order: string[], id: string, dir: -1 | 1): string[] {
  const arr = [...order];
  const from = arr.indexOf(id);
  const base = from === -1 ? arr.length : from;
  const to = Math.max(0, Math.min(arr.length - 1, base + dir));
  if (from === -1) arr.push(id);
  else { arr.splice(from, 1); arr.splice(to, 0, id); }
  return arr;
}
