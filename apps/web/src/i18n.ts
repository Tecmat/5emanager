export type Lang = 'it' | 'en';

const KEY = 'dnd5e.lang';

export function getLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'it';
  } catch {
    return 'it';
  }
}

export function storeLang(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* ignora */ }
}

const STR: Record<Lang, Record<string, string>> = {
  it: {
    'app.sheets': 'Gestore schede',
    'app.new': '＋ Nuovo',
    'app.theme': 'Cambia tema',
    'app.switcher': 'Cambia scheda personaggio',
    'app.sheetsCount': 'schede',
    'tab.panoramica': 'Panoramica',
    'tab.incantesimi': 'Incantesimi',
    'tab.inventario': 'Inventario',
    'tab.combattimento': '⚔️ Combattimento',
    'tab.campagna': '🌐 Campagna',
    'tab.custom': 'Contenuti custom',
    'cf.title': 'Nuovo personaggio',
    'cf.name': 'Nome',
    'cf.namePh': 'Aldric il Coraggioso',
    'cf.race': 'Razza',
    'cf.subrace': 'Sottorazza',
    'cf.none': '(nessuna)',
    'cf.class': 'Classe',
    'cf.method': 'Metodo statistiche',
    'cf.standard': 'Array standard',
    'cf.pointbuy': 'Point-buy (27 pt)',
    'cf.roll': 'Tiri 4d6',
    'cf.scores': 'Punteggi caratteristica',
    'cf.used': 'punti usati',
    'cf.skills': 'Abilità della classe',
    'cf.choose': 'a scelta',
    'cf.create': 'Crea personaggio',
    'cf.cancel': 'Annulla',
    'cf.rollAll': 'Tira tutti (4d6, scarta il peggiore)',
    'cf.rollOne': 'Tira 4d6',
    'cf.pbError': 'Point-buy non valido: punteggi 8-15, budget 27 (usati',
    'cf.unknownError': 'Errore sconosciuto',
  },
  en: {
    'app.sheets': 'Character manager',
    'app.new': '＋ New',
    'app.theme': 'Toggle theme',
    'app.switcher': 'Switch character sheet',
    'app.sheetsCount': 'sheets',
    'tab.panoramica': 'Overview',
    'tab.incantesimi': 'Spells',
    'tab.inventario': 'Inventory',
    'tab.combattimento': '⚔️ Combat',
    'tab.campagna': '🌐 Campaign',
    'tab.custom': 'Custom content',
    'cf.title': 'New character',
    'cf.name': 'Name',
    'cf.namePh': 'Aldric the Brave',
    'cf.race': 'Race',
    'cf.subrace': 'Subrace',
    'cf.none': '(none)',
    'cf.class': 'Class',
    'cf.method': 'Ability score method',
    'cf.standard': 'Standard array',
    'cf.pointbuy': 'Point-buy (27 pts)',
    'cf.roll': 'Roll 4d6',
    'cf.scores': 'Ability scores',
    'cf.used': 'points used',
    'cf.skills': 'Class skills',
    'cf.choose': 'to choose',
    'cf.create': 'Create character',
    'cf.cancel': 'Cancel',
    'cf.rollAll': 'Roll all (4d6, drop lowest)',
    'cf.rollOne': 'Roll 4d6',
    'cf.pbError': 'Invalid point-buy: scores 8-15, budget 27 (used',
    'cf.unknownError': 'Unknown error',
  },
};

export function t(lang: Lang, key: string, fallback?: string): string {
  return STR[lang][key] ?? fallback ?? key;
}
