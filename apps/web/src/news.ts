/**
 * Novità mostrate in-app al cambio di versione (dialog "Novità della vX.Y.Z").
 * La chiave `dnd5e.newsSeen.v1` in localStorage registra l'ultima versione vista.
 * Le voci rispecchiano CHANGELOG.md (repo root).
 */

export interface NewsEntry {
  version: string;
  it: string[];
  en: string[];
}

export const NEWS_SEEN_KEY = 'dnd5e.newsSeen.v1';

export const NEWS: NewsEntry[] = [
  {
    version: '0.2.0',
    it: [
      'Versionamento delle schede: snapshot automatici (max 1/ora), "Salva versione" manuale e snapshot prima del level-up, con ripristino ed eliminazione.',
      'Storico dei tiri del combattimento (attacchi, danni, initiative) con card dedicata, in locale e online.',
      'Editor incantesimi custom con campo upcast e anteprima dei dadi extra per slot.',
      'Accessibilità: focus visibile, aria-current sulle tab, aria-label sui bottoni solo-icona, rispetto di prefers-reduced-motion.',
      'Dado animato con suono opzionale (toggle persistente).',
      'Test e2e multiplayer: host via app e giocatore via server, XP dal master verificato in CI.',
      'Audit automatico dei dati SRD (12 classi, archetipi, incantesimi) in CI.',
    ],
    en: [
      'Sheet versioning: automatic snapshots (max 1/hour), manual "Save version" and pre-level-up snapshot, with restore and delete.',
      'Combat roll history (attacks, damage, initiative) with a dedicated card, local and online.',
      'Custom spell editor with upcast field and extra-dice preview per slot.',
      'Accessibility: visible focus, aria-current on tabs, aria-label on icon-only buttons, prefers-reduced-motion respected.',
      'Animated dice roll with optional sound (persistent toggle).',
      'Multiplayer e2e test: host via app and player via server, master XP verified in CI.',
      'Automatic SRD data audit (12 classes, archetypes, spells) in CI.',
    ],
  },
  {
    version: '0.1.97',
    it: [
      'Pronto per il Play Store: AAB release-signed nelle release, niente self-update in-app su APK/AAB (aggiornamenti via Play), nessuna richiesta di REQUEST_INSTALL_PACKAGES.',
      'Moderazione lato server: blocca/segnala giocatore + log di moderazione attivabile; immagini PG validate server-side (tipo, magic bytes, dimensioni, 1 MiB max).',
      'Background come entità SRD con competenze automatiche.',
      'Pulsante update solo dove serve: desktop sempre, web solo admin loggato, APK solo indicatore di versione. Safe-area Android, PDF scheda stile pergamena, export JSON su AppImage.',
    ],
    en: [
      'Play Store ready: release-signed AAB in releases, no in-app self-update on APK/AAB (updates via Play), no REQUEST_INSTALL_PACKAGES.',
      'Server-side moderation: block/report player + toggleable moderation log; server-side character image validation (type, magic bytes, dimensions, 1 MiB max).',
      'Backgrounds as SRD entities with automatic skill proficiencies.',
      'Update button only where needed: desktop always, web only for logged-in admin, APK version badge only. Android safe-area, parchment-style PDF sheet, JSON export on AppImage.',
    ],
  },
];

export function newsFor(version: string): NewsEntry | undefined {
  return NEWS.find((n) => n.version === version);
}
