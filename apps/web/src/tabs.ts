import type { IconName } from './icons.js';

/** pagine principali del menu (la pagina "scheda" esiste solo con una scheda attiva) */
export type MainPageId = 'home' | 'campagna' | 'p2p' | 'custom';
export type Page = MainPageId | 'scheda';

/** tab interne alla pagina scheda */
export type SheetTabId = 'panoramica' | 'incantesimi' | 'inventario' | 'combattimento';

export const MAIN_PAGES: { id: MainPageId; icon: IconName; key: string; fb: string }[] = [
  { id: 'home', icon: 'home', key: 'tab.home', fb: 'Home' },
  { id: 'campagna', icon: 'map', key: 'tab.campagna', fb: 'Campagna' },
  { id: 'p2p', icon: 'save', key: 'tab.p2p', fb: 'Campagne P2P' },
  { id: 'custom', icon: 'flask', key: 'tab.custom', fb: 'Contenuti custom' },
];

export const SHEET_TABS: { id: SheetTabId; icon: IconName; key: string; fb: string }[] = [
  { id: 'panoramica', icon: 'user', key: 'tab.panoramica', fb: 'Panoramica' },
  { id: 'incantesimi', icon: 'wand', key: 'tab.incantesimi', fb: 'Incantesimi' },
  { id: 'inventario', icon: 'bag', key: 'tab.inventario', fb: 'Inventario' },
  { id: 'combattimento', icon: 'swords', key: 'tab.combattimento', fb: 'Combattimento' },
];
