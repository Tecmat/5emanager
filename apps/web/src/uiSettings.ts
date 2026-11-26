import { useSyncExternalStore } from 'react';

/**
 * Impostazioni UI persistenti (localStorage `dnd5e.ui.v1`): tema, temi colore completi (superfici+accenti),
 * raggio angoli / stile bordi, set di icone e ordinamento/visibilità delle tab.
 * `applyUISettings` scrive le CSS variable su :root, quindi il tema si applica
 * a tutta l'app senza ricaricare.
 */

export type ThemePref = 'dark' | 'light' | 'auto';
export type IconSet = 'classic' | 'lucide' | 'rpg';
export type BorderStyle = 'soft' | 'sharp' | 'pill';

/** colori completi di un tema: superfici + accenti (per variante scura/chiara) */
export interface ThemeColors {
  bg: string;
  panel: string;
  panel2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
}

/** retrocompatibilit\u00e0: le palette anciennes avevano solo accent/accent2 */
export type PaletteColors = Pick<ThemeColors, 'accent' | 'accent2'>;

export interface PalettePreset {
  id: string;
  nameKey: string;
  nameFb: string;
  dark: ThemeColors;
  light: ThemeColors;
}

/* superfici dei temi completi (usate anche come fallback per i colori custom) */
const CLASSIC_DARK: ThemeColors = { bg: '#14110d', panel: '#201b15', panel2: '#2a231b', border: '#3e352a', text: '#ece4d4', muted: '#a3947c', accent: '#c9a227', accent2: '#8a6fd8' };
const CLASSIC_LIGHT: ThemeColors = { bg: '#f3edde', panel: '#fffdf4', panel2: '#efe6d0', border: '#d6c9ab', text: '#2c2517', muted: '#71654c', accent: '#9a7a0c', accent2: '#5f43d6' };
const TAVERN_DARK: ThemeColors = { bg: '#191008', panel: '#251a0f', panel2: '#312214', border: '#4d3a22', text: '#f2e8d5', muted: '#b5a284', accent: '#e3a92f', accent2: '#d96c2f' };
const PARCHMENT_LIGHT: ThemeColors = { bg: '#efe4c8', panel: '#fbf3dd', panel2: '#f0e3c2', border: '#d3bd90', text: '#3b2f1a', muted: '#7c6b4a', accent: '#9a6b10', accent2: '#b0561d' };
const ARCANE_DARK: ThemeColors = { bg: '#0e0c1e', panel: '#1b1633', panel2: '#262052', border: '#3d3476', text: '#e9e5fa', muted: '#9d95c8', accent: '#a06cd5', accent2: '#e0b34a' };
const ARCANE_LIGHT: ThemeColors = { bg: '#eeebfa', panel: '#faf8ff', panel2: '#e7e1f6', border: '#cfc5ea', text: '#2b2450', muted: '#6f679c', accent: '#7d3fc4', accent2: '#9a7a0c' };

/** palette = tema completo (superfici + accenti); le "solo accento" riusan le superfici classiche */
function accentOnly(id: string, nameKey: string, nameFb: string, dark: PaletteColors, light: PaletteColors): PalettePreset {
  return { id, nameKey, nameFb, dark: { ...CLASSIC_DARK, ...dark }, light: { ...CLASSIC_LIGHT, ...light } };
}

/** temi predefiniti: ogni voce definisce SUPERFICI e accenti per tema scuro e chiaro */
export const PALETTES: PalettePreset[] = [
  { id: 'tavern', nameKey: 'ui.pal.tavern', nameFb: 'Taverna', dark: TAVERN_DARK, light: PARCHMENT_LIGHT },
  { id: 'arcane', nameKey: 'ui.pal.arcane', nameFb: 'Arcano', dark: ARCANE_DARK, light: ARCANE_LIGHT },
  { id: 'gold', nameKey: 'ui.pal.gold', nameFb: 'Classico (oro)', dark: CLASSIC_DARK, light: CLASSIC_LIGHT },
  accentOnly('forest', 'ui.pal.forest', 'Foresta', { accent: '#4caf7d', accent2: '#d8a03f' }, { accent: '#2e7d4f', accent2: '#9a7a0c' }),
  accentOnly('blood', 'ui.pal.blood', 'Sangue', { accent: '#d05a5a', accent2: '#8a6fd8' }, { accent: '#a82f2f', accent2: '#5f43d6' }),
  accentOnly('ocean', 'ui.pal.ocean', 'Oceano', { accent: '#4f9dd8', accent2: '#d8a03f' }, { accent: '#2273b8', accent2: '#9a7a0c' }),
  accentOnly('mono', 'ui.pal.mono', 'Monocromatico', { accent: '#b8b8c0', accent2: '#8a6fd8' }, { accent: '#55555e', accent2: '#5f43d6' }),
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
  /** animazioni e transizioni UI (rispettano comunque prefers-reduced-motion) */
  animations: boolean;
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
    paletteId: 'tavern',
    accent: '#e3a92f',
    accent2: '#d96c2f',
    radius: 8,
    border: 'soft',
    iconSet: 'classic',
    animations: true,
    mainTabOrder: [],
    mainTabHidden: [],
    sheetTabOrder: [],
    sheetTabHidden: [],
  };
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Carica e VALIDA le impostazioni UI: un valore corrotto (JSON parziale, tipi sbagliati,
 * colori non-hex) cade sul default campo per campo; se il JSON non parseggia la chiave
 * viene rimossa (self-heal) — così un file corrotto non rompe più l'app all'avvio
 * (su Windows prima bisognava cancellare AppData/Local/com.tecmat.5emanager).
 */
export function loadUISettings(): UISettings {
  const d = defaultUISettings();
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<UISettings>;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('ui settings non valide');
    return {
      theme: p.theme === 'dark' || p.theme === 'light' || p.theme === 'auto' ? p.theme : d.theme,
      paletteId: typeof p.paletteId === 'string' && (p.paletteId === 'custom' || PALETTES.some((x) => x.id === p.paletteId)) ? p.paletteId : d.paletteId,
      accent: typeof p.accent === 'string' && HEX_RE.test(p.accent) ? p.accent : d.accent,
      accent2: typeof p.accent2 === 'string' && HEX_RE.test(p.accent2) ? p.accent2 : d.accent2,
      radius: typeof p.radius === 'number' && Number.isFinite(p.radius) ? p.radius : d.radius,
      border: p.border === 'soft' || p.border === 'sharp' || p.border === 'pill' ? p.border : d.border,
      iconSet: p.iconSet === 'classic' || p.iconSet === 'lucide' || p.iconSet === 'rpg' ? p.iconSet : d.iconSet,
      animations: typeof p.animations === 'boolean' ? p.animations : d.animations,
      mainTabOrder: strArr(p.mainTabOrder),
      mainTabHidden: strArr(p.mainTabHidden),
      sheetTabOrder: strArr(p.sheetTabOrder),
      sheetTabHidden: strArr(p.sheetTabHidden),
    };
  } catch {
    try { localStorage.removeItem(UI_KEY); } catch { /* quota */ }
    return d;
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

/** applica le impostazioni scrivendo le CSS variable (tema completo: superfici + accenti) su :root e salvando su localStorage */
export function applyUISettings(s: UISettings): void {
  const root = document.documentElement;
  const theme = resolvedTheme(s);
  root.dataset.theme = theme;
  try { localStorage.setItem('dnd5e-theme', theme); } catch { /* quota */ }
  const pal = s.paletteId === 'custom' ? null : (PALETTES.find((p) => p.id === s.paletteId) ?? PALETTES[0]);
  // superfici: dalla palette scelta, oppure dal tema di default quando i colori sono custom
  const surf = (pal ?? PALETTES[0])[theme];
  const rawAccent = HEX_RE.test(s.accent) ? s.accent : surf.accent;
  const rawAccent2 = HEX_RE.test(s.accent2) ? s.accent2 : surf.accent2;
  const accent = pal ? surf.accent : (theme === 'light' ? darken(rawAccent, 0.3) : rawAccent);
  const accent2 = pal ? surf.accent2 : (theme === 'light' ? darken(rawAccent2, 0.15) : rawAccent2);
  root.style.setProperty('--bg', surf.bg);
  root.style.setProperty('--panel', surf.panel);
  root.style.setProperty('--panel2', surf.panel2);
  root.style.setProperty('--border', surf.border);
  root.style.setProperty('--text', surf.text);
  root.style.setProperty('--muted', surf.muted);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent2', accent2);
  root.style.setProperty('--accent-dim', rgba(accent, 0.5));
  root.style.setProperty('--stripe', rgba(accent, 0.05));
  root.style.setProperty('--gridline', rgba(accent, 0.06));
  const r = s.border === 'sharp' ? 2 : Math.max(0, Math.min(20, Math.round(Number.isFinite(s.radius) ? s.radius : 8)));
  root.style.setProperty('--radius', `${r}px`);
  root.style.setProperty('--btn-radius', s.border === 'pill' ? '999px' : `${r}px`);
  root.style.setProperty('--tag-radius', s.border === 'pill' ? '999px' : s.border === 'sharp' ? '4px' : '20px');
  root.dataset.border = s.border;
  root.dataset.iconSet = s.iconSet;
  root.dataset.animations = s.animations ? 'on' : 'off';
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
  const ord = Array.isArray(order) ? order : [];
  const hid = Array.isArray(hidden) ? hidden : [];
  const rank = new Map(ord.map((id, i) => [id, i]));
  const sorted = [...items].sort((a, b) => (rank.get(a.id) ?? 999 + items.indexOf(a)) - (rank.get(b.id) ?? 999 + items.indexOf(b)));
  return sorted.filter((t) => !hid.includes(t.id));
}

/** sposta un id in su/giù nell'array di ordinamento */
export function moveId(order: string[], id: string, dir: -1 | 1): string[] {
  const arr = Array.isArray(order) ? [...order] : [];
  const from = arr.indexOf(id);
  const base = from === -1 ? arr.length : from;
  const to = Math.max(0, Math.min(arr.length - 1, base + dir));
  if (from === -1) arr.push(id);
  else { arr.splice(from, 1); arr.splice(to, 0, id); }
  return arr;
}
