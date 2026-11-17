# D&D 5e — Gestore di Schede

Gestore di schede per Dungeons & Dragons 5e: level-up automatizzato, liste incantesimi,
inventario, combattimento, tiri dado e contenuti custom (incantesimi, armi, armature,
archetipi, classi intere). Disponibile come **WebApp/PWA**, **app desktop (Tauri)** e
**Android (Capacitor)** — un unico codebase.

## Avvio rapido (web)

Richiede Node.js ≥ 22.12 (per i test) — la web app gira anche con Node 18+.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # test del motore regole (vitest)
npm run typecheck  # tsc su tutti i package
```

## Struttura

```
packages/core       # motore regole TS puro: tipi, level-up, slot, CA, dadi, condizioni,
                    # combattimento, inventario, house-rules, validazione custom
packages/data-srd   # contenuti SRD (OGL) in JSON: 12 classi, 13 archetipi, 9 razze,
                    # ~100 incantesimi, 37 armi, 13 armature, talenti, stili
apps/web            # React + Vite + PWA (manifest + service worker)
src-tauri/          # wrapper desktop Tauri v2
```

## Funzionalità

- **Level-up guidato**: XP → dado vita → ASI/talento → stile → archetipo → expertise → slot (multiclasse inclusa)
- **Stat derivate automatiche**: modificatori, TS, CA, bonus attacco, PF, initiative, percezione passiva, carico
- **Incantesimi**: conosciuti/preparati, **limite appreso regolabile** (scambia con "Dimentica"), slot con upcast, concentration, riposo lungo
- **Meccaniche sbloccate col livello**: risorse con usi calcolati, attacchi extra, dado dell'attacco furtivo scalato
- **House-rules**: selettore per eludere regole (limite incantesimi, cap 20, sintonizzazione max 3, XP, livello 20)
- **Tira dado** con vantaggio/svantaggio; **condizioni** (avvelenato, prono, invisibile...)
- **Combattimento**: initiative, turni/round, PF e condizioni dei nemici
- **Inventario**: peso, equipaggiamento, sintonizzazione, valuta
- **Contenuti custom** validati, salvati in localStorage e separati dai dati SRD; scheda esportabile/importabile in JSON

## Desktop (Tauri v2)

Prerequisiti: [Rust toolchain](https://rustup.rs) + dipendenze di sistema (su Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, ecc. — vedi [tauri.app/prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
npm run tauri:dev     # finestra di sviluppo con hot-reload
npm run tauri:build   # pacchetti installabili (msi/deb/appimage/dmg/...)
```

## Android (Capacitor)

Prerequisiti: Android Studio + SDK (vedi [capacitorjs.com/docs/android](https://capacitorjs.com/docs/android)).

```bash
cd apps/web
npx cap add android        # prima volta: crea apps/web/android
npm run build:android      # build web + cap sync
npx cap open android       # apre Android Studio → genera APK/AAB
```

## Multiplayer (server self-hosted)

Il server gira anche **direttamente su Android via Termux** ([docs/ANDROID_SERVER.md](docs/ANDROID_SERVER.md)) o su un **server Debian con systemd** ([docs/DEPLOY_DEBIAN.md](docs/DEPLOY_DEBIAN.md)).

`npm run build -w @dnd5e/web && npm run server` → apre http://localhost:3001 con web app + WebSocket: campagne condivise master/giocatori, combattimento live con action economy (vedi [docs/SERVER.md](docs/SERVER.md)).

## PWA (installabile da browser)

In produzione (`npm run build -w @dnd5e/web` + `vite preview`) il service worker è
registrato automaticamente: dal browser scegli "Aggiungi a schermata Home" / "Installa app".

## Licenze

Contenuti SRD 5e sotto OGL 1.0a / CC-BY 4.0 (Wizards of the Coast). I contenuti non-SRD
vanno inseriti solo come custom dall'utente.

## Nota sicurezza

`npm audit` può segnalare avvisi high su tooling solo di sviluppo (vite/vitest/picomatch): i pacchetti sono tutti all'ultima versione; il runtime (bundle browser + server `ws`) non è coinvolto. Test: 45/45 verdi.
