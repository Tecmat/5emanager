# Roadmap — espansione di 5e Manager

Idee per espandere drasticamente il gestore di schede. Ogni voce indica **dove si innesta**
nell'architettura attuale: `packages/core` (regole), `packages/data-srd` (dati JSON),
`apps/web` (UI), `src-tauri` / Capacitor (piattaforme).

Priorità: **P0** = subito, alto valore/basso costo · **P1** = medio termine · **P2** = visions

---

## 1. Scheda personaggio (core + web)

- **P0** Point-buy / standard array / tiro 4d6-scarta il peggiore in creazione (`CreateForm`, `core/character.ts`)
- **P0** Inspiration come toggle cliccabile (già in dati, manca il bottone in UI)
- **P0** **Tiri della morte** (successi/fallimenti con click, reset a 1 PF o stabilizzato) — `core/rules/combat.ts` o nuovo `death-saves.ts`
- **P0** Livelli di **esaurimento** (1–6) al posto della singola condizione — scala effetti automatici
- **P0** Multiclasse con **prerequisiti** (es. 13 Int per il mago): warning in `applyLevelUp`
- **P1** Ritratto/immagine del PG (upload → IndexedDB, non localStorage)
- **P1** **Diario di sessione / note con timestamp** (log automatico: XP, level-up, danni subiti)
- **P1** Esportazione scheda in **PDF stampabile** (CSS print + `window.print()`)
- **P1** Background e talenti come entità vere (oggi solo testo) — `data-srd` + selettori
- **P2** Cronologia con **undo** (snapshot dello stato prima di ogni azione)

## 2. Incantesimi (core/spells + web)

- **P0** Mostra **bonus attacco incantesimo** e **CD TS incantesimo** (8 + prof + mod) in Panoramica
- **P0** Preparazione separata **per classe** (multiclasse) invece che globale
- **P0** **Tracciamento componenti materiali** (consumabili con cariche, es. "diamante worth 500gp")
- **P0** Ritual casting: lanzio come rituale senza slot (10 min extra)
- **P1** Upcast automatico del danno (tabella `higherLevel` numerica, es. `+1d6/slot`) e pokazarlo nel lancio
- **P1** Concentration tracker nel tab Combattimento (chi sta concentrando cosa, reminder TS Con)
- **P1** Liste incantesimo custom per PG ("i miei preferiti", filtri per scuola/livello già presenti)
- **P2** Pergamene e oggetti che lanciano incantesimi (charges) nell'inventario

## 3. Combattimento (core/combat + web)

- **P0** Initiative automatica = 1d20 + mod Des del PG (oggi è un tiro cieco)
- **P0** **Durata delle condizioni in round** (es. "stordito 2 round") con decremento automatico a ogni turno
- **P0** Quick-toggles **vantaggio/svantaggio** applicati al prossimo tiro del tira-dado
- **P1** **Statblock nemici custom** (nome, CA, HP, attaques con dado e bonus) salvabili in `data-srd`-like JSON e riutilizzabili
- **P1** Log dei tiri del combattimento (history persistente per round)
- **P1** Tracker PF di tutto il gruppo (party) lato master
- **P1** Aree/zone (cono/sfera/linea) con mesures in griglia — toggle "mostratemplate"
- **P2** Timer di turno, musik/ambient, mappa tattica minimale con token trascinabili

## 4. Inventario (core/inventory + web)

- **P0** **Ricerca e filtri** (per tipo, magico, equipaggiato) + ordinamento colonne
- **P0** Oggetti **consumabili con cariche/usi** (pozioni, munizioni, batterie di bacchette)
- **P0** **Contenitori** (zaino dentro zaino) con peso ricorsivo
- **P1** Slot equipaggiamento standard (testa, amuleto, anelli x2, armatura, scudo, 2 mani...) con validazione equip
- **P1** Rarità e valore singamente, filtro per rarità, totale del tesoro
- **P2** Crafting/ricette, transactions con PNG (compra/vendi con calcolo resto)

## 5. Contenuti custom — editor avanzato (il cuore della "drastica" espansione)

- **P0** Editor UI completo per **classi** (form strutturato al posto del JSON a mano) + anteprima progressione
- **P0** Editor per **archetipi, razze, talenti, background, nemici (statblock)**
- **P0** **Mini-DSL degli effetti** interpretato dal core: `+1 CA`, `advantage: saves vs magic`, `+1d6 fire damage`, `proficiency: skill stealth`... (`core/rules/effects.ts` nuovo, `derived.ts` lo applica)
- **P1** **Pacchetti custom esportabili/importabili** (un file `.5epack` JSON con tutto: classi, incantesimi, nemici) — share tra giocatori
- **P1** Validazione "simula il personaggio" (test automatico che un PG custom sale di livello senza errori fino al 20)
- **P2** Editor di incantesimi con preview del danno medio e confronto con il baseline SRD

## 6. Campagna / strumenti master (nuovo `packages/campaign`?)

- **P0** **Multi-personaggio**: più schede nella stessa app, switch rápido (party)
- **P0** **DM screen**: vista compatta con PG, PF, CA, TS passivi, condizioni — per il master
- **P1** Inventario di gruppo condiviso + tesoreria di gruppo
- **P1** Assegnazione XP di sessione a tutta la party + note di sessione condivise
- **P2** Generatore casuale (nomi, incontri, tesori) con tabelle in JSON

## 7. Dati e sync

- **P0** Passare da localStorage a **IndexedDB (Dexie)** — più capiente, query, backup più solidi
- **P0** **Import/export dell'intera libreria** (tutte le schede + custom) in un file
- **P1** **Sync cloud opzionale** (Supabase/Firebase) con login, multi-dispositivo, conflitto-last-write
- **P1** Versionamento schede (snapshot automatici giornalieri)
- **P2** Import da **D&D Beyond** (parsing del JSON esportato) — solo i tuoi dati, nel rispetto del copyright

## 8. Piattaforme e release

- **P0** CI **GitHub Actions**: su ogni push → test + typecheck + build web; su tag `vX.Y.Z` → build Tauri (Linux/Windows/macOS) + APK Android + allega alla release
- **P1** Firma/notarizzazione pacchetti desktop (macOS, Windows)
- **P1** PWA completa offline (già service worker base: migliorare con Workbox)
- **P2** iOS via Capacitor (stesso codice), notifiche push (promemoria sessione)

## 9. UX e accessibilità (apps/web)

- **P0** **Tema chiaro/scuro** (CSS variables già pronte in `styles.css`)
- **P0** i18n **IT/EN** (tutti i testi in file `locales/`)
- **P1** Scorciatoie da tastiera, comandi rapidi (cmd-K palette)
- **P1** Animazioni tiro dado, suoni opzionali
- **P2** Accessibilità completa (screen reader, contrasto WCAG, riduzione movimento)

## 10. Qualità

- **P1** Test e2e con **Playwright** (flusso: crea PG → XP → level-up → lancia incantesimo)
- **P1** Copertura core > 90% (oggi 39 test unit)
- **P2** Performance: virtualizzazione liste lunghe (grimorio 100+ incantesimi), code-splitting per tab

---

## Quick wins (questa settimana)

1. Toggle inspiration + tiro morte con click (P0)
2. Bonus/CD incantesimo in Panoramica (P0)
3. Initiative automatica dal Des (P0)
4. Tema chiaro (P0)
5. i18n IT/EN base (P0)
6. Ricerca in inventario e grimorio (P0)

## Visione

"Il gestore di schede che non ti fa più aprire il manuale": ogni regola in un file JSON
validato, ogni effetto interpretato dal core, custom pack condivisibili, party sync,
DM screen — su web, desktop e telefono, offline-first.
