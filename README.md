# D&D 5e — Gestore di Schede

Gestore di schede per Dungeons & Dragons 5e: level-up automatizzato, liste incantesimi,
inventario e contenuti custom (incantesimi, armi, armature, archetipi, classi intere).

## Target

- **WebApp** (PWA) — `apps/web`, React + TypeScript + Vite
- **Desktop** — wrapper Tauri v2 della stessa web app (da aggiungere in `src-tauri/`)
- **Android** — wrapper Capacitor (`npx cap add android` dentro `apps/web`)

Un unico codebase web, dati local-first (localStorage/IndexedDB) + export/import JSON.

## Struttura

```
packages/core       # motore regole in TS puro: tipi, level-up, slot, CA, inventario, validazione
packages/data-srd   # contenuti base 5e SRD (OGL) in JSON: 5 classi, 6 archetipi, 9 razze,
                    # ~100 incantesimi, 37 armi, 13 armature, talenti, stili di combattimento
apps/web            # interfaccia React: Panoramica / Incantesimi / Inventario / Contenuti custom
```

## Comandi

```bash
npm install
npm test          # 23 test del motore regole (vitest)
npm run typecheck # tsc su tutti i package
npm run dev       # avvia la web app su http://127.0.0.1:5173
```

## Come funziona il level-up

`applyLevelUp` (in `packages/core/src/rules/levelup.ts`) applica dado vita, feature
della classe/sottoclasse, ASI o talento, stile di combattimento, archetipo, expertise
e ricalcola gli slot incantesimo (anche in multiclasse, con la regola del livello caster).

## Contenuti custom

Dalla tab "Contenuti custom" si aggiungono incantesimi/armi/armature (form) e classi
intere (JSON, validato). I custom restano separati dai dati SRD e sono salvati in
localStorage; si esportano con `exportCustomContent(reg)`.

## Licenze

I contenuti SRD 5e sono sotto OGL 1.0a / CC-BY 4.0 (Wizards of the Coast). I contenuti
non-SRD vanno inserted solo come custom dall'utente.
