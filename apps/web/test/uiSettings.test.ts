// @vitest-environment jsdom
/**
 * Test personalizzazione UI (v0.1.71): uiSettings (palette, tema, tab order) e import D&D Beyond.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PALETTES,
  UI_KEY,
  applyUISettings,
  darken,
  defaultUISettings,
  hexToRgb,
  loadUISettings,
  getUISettings,
  moveId,
  orderTabs,
  rgba,
  subscribeUISettings,
  updateUISettings,
} from '../src/uiSettings.js';
import { MAIN_PAGES, SHEET_TABS } from '../src/tabs.js';
import { parseDdbJson } from '../src/ddbImport.js';
import { createSrdRegistry } from '@dnd5e/data-srd';
import { totalLevel } from '@dnd5e/core';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-border');
  document.documentElement.removeAttribute('data-icon-set');
  document.documentElement.removeAttribute('data-animations');
});

describe('uiSettings', () => {
  it('default: tema auto (o da dnd5e-theme legacy), palette gold, tab default', () => {
    localStorage.setItem('dnd5e-theme', 'light');
    const s = defaultUISettings();
    expect(s.theme).toBe('light');
    expect(s.paletteId).toBe('tavern');
    expect(s.iconSet).toBe('classic');
    expect(s.animations).toBe(true);
    localStorage.removeItem('dnd5e-theme');
    expect(defaultUISettings().theme).toBe('auto');
  });

  it('applyUISettings scrive le CSS var sul :root e persiste', () => {
    const s = { ...defaultUISettings(), theme: 'dark' as const, paletteId: 'ocean' };
    applyUISettings(s);
    const root = document.documentElement;
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.getPropertyValue('--accent')).toBe(PALETTES.find((p) => p.id === 'ocean')!.dark.accent);
    expect(root.style.getPropertyValue('--accent2')).toBe(PALETTES.find((p) => p.id === 'ocean')!.dark.accent2);
    expect(root.style.getPropertyValue('--radius')).toBe('8px');
    expect(JSON.parse(localStorage.getItem(UI_KEY)!).paletteId).toBe('ocean');
    // tema chiaro usa la variante light della palette
    applyUISettings({ ...s, theme: 'light' });
    expect(root.style.getPropertyValue('--accent')).toBe(PALETTES.find((p) => p.id === 'ocean')!.light.accent);
  });

  it('colori custom: paletteId custom usa i colori scelti (light = scurito)', () => {
    applyUISettings({ ...defaultUISettings(), theme: 'dark', paletteId: 'custom', accent: '#ff0000', accent2: '#00ff00' });
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ff0000');
    applyUISettings({ ...defaultUISettings(), theme: 'light', paletteId: 'custom', accent: '#ff0000', accent2: '#00ff00' });
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(darken('#ff0000', 0.3));
  });

  it('stile bordi: sharp fuerza raggio 2, pill mette i bottoni a capsula', () => {
    applyUISettings({ ...defaultUISettings(), border: 'sharp', radius: 12 });
    expect(document.documentElement.style.getPropertyValue('--radius')).toBe('2px');
    applyUISettings({ ...defaultUISettings(), border: 'pill', radius: 12 });
    expect(document.documentElement.style.getPropertyValue('--btn-radius')).toBe('999px');
    expect(document.documentElement.style.getPropertyValue('--radius')).toBe('12px');
  });

  it('updateUISettings persiste e notifica i subscriber', () => {
    let n = 0;
    const unsub = subscribeUISettings(() => { n++; });
    updateUISettings({ iconSet: 'lucide' });
    expect(n).toBe(1);
    expect(getUISettings().iconSet).toBe('lucide');
    expect(loadUISettings().iconSet).toBe('lucide');
    unsub();
  });

  it('hexToRgb / rgba / darken', () => {
    expect(hexToRgb('#c9a227')).toEqual([201, 162, 39]);
    expect(hexToRgb('nope')).toBeNull();
    expect(rgba('#c9a227', 0.5)).toBe('rgba(201, 162, 39, 0.5)');
    expect(darken('#ffffff', 0.5)).toBe('#808080');
  });

  it('orderTabs: ordina secondo l\'ordine salvato, mette i nuovi in coda, filtra le nascoste', () => {
    const items = MAIN_PAGES; // home, campagna, p2p, custom, account
    expect(orderTabs(items, [], []).map((t) => t.id)).toEqual(['home', 'campagna', 'p2p', 'custom', 'account']);
    expect(orderTabs(items, ['custom', 'home'], []).map((t) => t.id)).toEqual(['custom', 'home', 'campagna', 'p2p', 'account']);
    expect(orderTabs(items, ['p2p', 'campagna'], ['p2p']).map((t) => t.id)).toEqual(['campagna', 'home', 'custom', 'account']);
  });

  it('moveId: sposta su/gi\u00f9 con clamp ai bordi', () => {
    expect(moveId(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveId([], 'x', -1)).toEqual(['x']);
  });

  it('SHEET_TABS restano riordinabili', () => {
    expect(orderTabs(SHEET_TABS, ['combattimento', 'panoramica'], ['inventario']).map((t) => t.id))
      .toEqual(['combattimento', 'panoramica', 'incantesimi']);
  });
});

describe('robustezza impostazioni UI (fix v0.1.73: tab scomparse dopo update su Windows)', () => {
  it('JSON corrotto -> default + chiave rimossa (self-heal, niente AppData da cancellare)', () => {
    localStorage.setItem(UI_KEY, '{non json');
    const s = loadUISettings();
    expect(s.paletteId).toBe('tavern');
    expect(s.mainTabOrder).toEqual([]);
    expect(localStorage.getItem(UI_KEY)).toBeNull();
  });

  it('tipi sbagliati -> default campo per campo, senza crash', () => {
    localStorage.setItem(UI_KEY, JSON.stringify({
      theme: 'rosa', accent: 'red', accent2: 42, radius: 'tanto', border: 'x', iconSet: 7,
      paletteId: 'inesistente', mainTabOrder: { 0: 'home' }, mainTabHidden: 'home', sheetTabOrder: null,
    }));
    const s = loadUISettings();
    expect(s.theme).toBe('auto');
    expect(s.accent).toBe('#e3a92f');
    expect(s.accent2).toBe('#d96c2f');
    expect(s.radius).toBe(8);
    expect(s.border).toBe('soft');
    expect(s.iconSet).toBe('classic');
    expect(s.paletteId).toBe('tavern');
    expect(s.mainTabOrder).toEqual([]);
    expect(s.mainTabHidden).toEqual([]);
    expect(s.sheetTabOrder).toEqual([]);
  });

  it('valori validi vengono mantenuti', () => {
    localStorage.setItem(UI_KEY, JSON.stringify({
      theme: 'light', paletteId: 'ocean', accent: '#aabbcc', accent2: '#112233', radius: 12,
      border: 'pill', iconSet: 'lucide', mainTabOrder: ['custom', 'home'], mainTabHidden: ['p2p'],
    }));
    const s = loadUISettings();
    expect(s).toMatchObject({ theme: 'light', paletteId: 'ocean', accent: '#aabbcc', radius: 12, border: 'pill', iconSet: 'lucide', mainTabOrder: ['custom', 'home'], mainTabHidden: ['p2p'] });
  });

  it('orderTabs/moveId non si rompono con input non-array', () => {
    expect(orderTabs(MAIN_PAGES, 'garbage' as never, 42 as never).map((t) => t.id)).toEqual(['home', 'campagna', 'p2p', 'custom', 'account']);
    expect(MAIN_PAGES.some((p) => p.id === 'account')).toBe(true);
    expect(moveId(null as never, 'home', -1)).toEqual(['home']);
  });

  it('applyUISettings ignora un colore non-hex (fallback alla palette di default)', () => {
    applyUISettings({ ...defaultUISettings(), theme: 'dark', paletteId: 'custom', accent: 'non-un-colore', accent2: '#00ff00' });
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(PALETTES[0].dark.accent);
    expect(document.documentElement.style.getPropertyValue('--accent2')).toBe('#00ff00');
  });

  it('applyUISettings con radius non numerico non scrive NaN', () => {
    applyUISettings({ ...defaultUISettings(), border: 'soft', radius: NaN });
    expect(document.documentElement.style.getPropertyValue('--radius')).toBe('8px');
  });

  it('tema completo: applyUISettings scrive anche le superfici (bg/panel/border/text) dalla palette', () => {
    const tavern = PALETTES.find((p) => p.id === 'tavern')!;
    applyUISettings({ ...defaultUISettings(), theme: 'dark', paletteId: 'tavern' });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg')).toBe(tavern.dark.bg);
    expect(root.style.getPropertyValue('--panel')).toBe(tavern.dark.panel);
    expect(root.style.getPropertyValue('--border')).toBe(tavern.dark.border);
    expect(root.style.getPropertyValue('--text')).toBe(tavern.dark.text);
    expect(root.style.getPropertyValue('--accent')).toBe(tavern.dark.accent);
    applyUISettings({ ...defaultUISettings(), theme: 'light', paletteId: 'tavern' });
    expect(root.style.getPropertyValue('--bg')).toBe(tavern.light.bg);
    expect(root.style.getPropertyValue('--accent')).toBe(tavern.light.accent);
  });

  it('colori custom: le superfici restano quelle del tema di default, gli accenti sono custom', () => {
    const def = PALETTES[0];
    applyUISettings({ ...defaultUISettings(), theme: 'dark', paletteId: 'custom', accent: '#ff0000', accent2: '#00ff00' });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg')).toBe(def.dark.bg);
    expect(root.style.getPropertyValue('--accent')).toBe('#ff0000');
    expect(root.style.getPropertyValue('--accent2')).toBe('#00ff00');
  });

  it('animazioni: flag booleano -> data-animations su :root, persistito e validato', () => {
    applyUISettings({ ...defaultUISettings(), animations: false });
    expect(document.documentElement.dataset.animations).toBe('off');
    expect(loadUISettings().animations).toBe(false);
    applyUISettings({ ...defaultUISettings(), animations: true });
    expect(document.documentElement.dataset.animations).toBe('on');
    localStorage.setItem(UI_KEY, JSON.stringify({ animations: 'sì' }));
    expect(loadUISettings().animations).toBe(true);
  });

  it('iconSet rpg accettato; paletteId legacy (gold) resta valido', () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ iconSet: 'rpg', paletteId: 'gold' }));
    const s = loadUISettings();
    expect(s.iconSet).toBe('rpg');
    expect(s.paletteId).toBe('gold');
    applyUISettings(s);
    expect(document.documentElement.dataset.iconSet).toBe('rpg');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(PALETTES.find((p) => p.id === 'gold')!.dark.accent);
  });
});

describe('import D&D Beyond (ddbImport)', () => {
  const reg = createSrdRegistry();
  const sample = {
    data: {
      name: 'Kaelen',
      race: { fullName: 'Elf' },
      subrace: { fullName: 'High Elf' },
      classes: [{ definition: { name: 'Wizard', level: 5 } }],
      stats: [
        { id: 1, value: 8 }, { id: 2, value: 14 }, { id: 3, value: 12 },
        { id: 4, value: 16 }, { id: 5, value: 13 }, { id: 6, value: 10 },
      ],
    },
  };

  it('parsa un export DDB standard (nome, razza, classe, livello, caratteristiche)', () => {
    const res = parseDdbJson(JSON.stringify(sample), reg);
    expect(res.errors).toEqual([]);
    expect(res.character).toBeDefined();
    const c = res.character!;
    expect(c.name).toBe('Kaelen');
    expect(c.raceId).toBe('elf');
    expect(c.subraceId).toBe('high-elf');
    expect(c.classLevels[0]).toMatchObject({ classId: 'wizard', level: 5 });
    expect(totalLevel(c)).toBe(5);
    // elfo alto: +1 INT razziale, più ASI automatico ai livelli // il valore base 16 sale con i bonus
    expect(c.abilityScores.int).toBeGreaterThanOrEqual(16);
    expect(c.abilityScores.str).toBe(8);
  });

  it('accetta anche la radice senza wrapper "data" e nomi italiani', () => {
    const res = parseDdbJson(JSON.stringify({ name: 'Brun', race: 'Nano', classes: [{ name: 'Guerriero', level: 3 }], stats: [] }), reg);
    expect(res.character).toBeDefined();
    expect(res.character!.raceId).toBe('dwarf');
    expect(res.character!.classLevels[0].classId).toBe('fighter');
    expect(res.warnings.join(' ')).toMatch(/standard/);
  });

  it('multiclasse: prende la classe principale e avvisa', () => {
    const multi = { data: { name: 'Mix', race: 'Human', classes: [
      { definition: { name: 'Fighter', level: 4 } },
      { definition: { name: 'Rogue', level: 3 } },
    ], stats: [] } };
    const res = parseDdbJson(JSON.stringify(multi), reg);
    expect(res.character!.classLevels[0]).toMatchObject({ classId: 'fighter', level: 4 });
    expect(totalLevel(res.character!)).toBe(4);
    expect(res.warnings.join(' ')).toMatch(/Multiclasse/);
  });

  it('rifiuta JSON non valido e formati non riconosciuti', () => {
    expect(parseDdbJson('non json', reg).errors.length).toBeGreaterThan(0);
    expect(parseDdbJson('{"foo": 1}', reg).errors.join(' ')).toMatch(/non riconosciuto/);
    const badClass = { data: { name: 'X', race: 'Human', classes: [{ definition: { name: 'Artificer', level: 1 } }], stats: [] } };
    expect(parseDdbJson(JSON.stringify(badClass), reg).errors.join(' ')).toMatch(/Classe non supportata/);
    const badRace = { data: { name: 'X', race: 'Aarakocra', classes: [{ definition: { name: 'Fighter', level: 1 } }], stats: [] } };
    expect(parseDdbJson(JSON.stringify(badRace), reg).errors.join(' ')).toMatch(/Razza non supportata/);
  });
});
