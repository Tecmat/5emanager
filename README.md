# D&D 5e — Gestore di Schede

Gestore di schede per Dungeons & Dragons 5e: level-up automatizzato, liste incantesimi,
inventario, combattimento, tiri dado e contenuti custom (incantesimi, armi, armature,
archetipi, classi intere). Disponibile come **WebApp/PWA**, **app desktop (Tauri)** e
**Android (Capacitor)** — un unico codebase. Multiplayer **P2P sulla stessa rete WiFi**
(niente server: scoperta automatica, codice invito/QR) oppure con server self-hosted,
con campagne condivise master/giocatori e combattimento live.

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
packages/server     # Node + ws (opzionale): HTTP statici + WebSocket, campagne JSON,
                    # relay/announce P2P, pannello admin
apps/web            # React + Vite + PWA (manifest + service worker)
src-tauri/          # wrapper desktop Tauri v2
```

## Funzionalità

- **Multiplayer**: campagna condivisa master/giocatori con combattimento live — **P2P sulla stessa WiFi** (scansione automatica della rete, codice invito + QR, WebRTC con fallback relay) oppure **server self-hosted** (vedi sotto)
- **Level-up guidato**: XP → dado vita → ASI/talento → stile → archetipo → expertise → slot (multiclasse inclusa)
- **Stat derivate automatiche**: modificatori, TS, CA, bonus attacco, PF, initiative, percezione passiva, carico
- **Incantesimi**: conosciuti/preparati, **limite appreso regolabile** (scambia con "Dimentica"), slot con upcast, concentration, riposo lungo
- **Meccaniche sbloccate col livello**: risorse con usi calcolati, attacchi extra, dado dell'attacco furtivo scalato
- **House-rules**: selettore per eludere regole (limite incantesimi, cap 20, sintonizzazione max 3, XP, livello 20)
- **Tira dado** con vantaggio/svantaggio; **condizioni** (avvelenato, prono, invisibile...)
- **Combattimento**: initiative, turni/round, PF e condizioni dei nemici, **mappa tattica con token trascinabili** (griglia 5 ft, sincronizzata in multiplayer) e **party tracker del master** sempre visibile
- **Inventario**: peso, equipaggiamento, sintonizzazione, valuta
- **Contenuti custom** validati, salvati in localStorage e separati dai dati SRD; scheda esportabile/importabile in JSON
- **Personalizzazione interfaccia**: tema scuro/chiaro/auto, palette colori (predefinite o custom), stile bordi e raggio angoli, set icone (interne o Lucide open source) e riordino/nascosdi delle tab principali e della scheda
- **PWA offline**: app installabile che funziona senza rete (shell + dati in cache), indicatore offline e promemoria di sessione con notifica
- **Import da D&D Beyond**: export JSON proprio importato come nuova scheda (best-effort)

## Desktop (Tauri v2)

Prerequisiti: [Rust toolchain](https://rustup.rs) + dipendenze di sistema (su Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, ecc. — vedi [tauri.app/prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
npm run tauri:dev     # finestra di sviluppo con hot-reload
npm run tauri:build   # pacchetti installabili (msi/deb/appimage/dmg/...)
```

Su **Arch Linux** c'è il pacchetto AUR `5emanager-bin` (AppImage ufficiale dalla release GitHub,
PKGBUILD in `deploy/aur/` — vedi [deploy/aur/README.md](deploy/aur/README.md)):

```bash
yay -S 5emanager-bin        # oppure: paru -S 5emanager-bin
```

Sulla **webapp servita dal server** (Docker) il setup "solo locale / server remoto" **non appare**:
lì si entra con il login (obbligatorio se `DND5E_REQUIRE_AUTH=true`) e la prima configurazione
riguarda solo l'admin del server (`/setup` la prima volta).

## Android (Capacitor)

Prerequisiti: Android Studio + SDK (vedi [capacitorjs.com/docs/android](https://capacitorjs.com/docs/android)).

```bash
cd apps/web
npx cap add android        # prima volta: crea apps/web/android
npm run build:android      # build web + cap sync
npx cap open android       # apre Android Studio → genera APK/AAB
```

## Multiplayer P2P — stessa WiFi, senza server 🕸️

Ogni dispositivo può **hostare la campagna** (WebRTC DataChannel; dove WebRTC manca, relay
opaco sul server se raggiungibile). I giocatori sullo **stesso WiFi/hotspot** entrano con
**un tap**: la app scansiona la rete e mostra gli host trovati (nome + IP), oppure si usa il
**codice invito breve `XXXX-XXXX` + QR** (copia / condivisione nativa — funziona anche via
WhatsApp). Su desktop (Tauri) e Android l'host può aprire anche un **beacon LAN nativo**
(porta 3177) e accettare/rifiutare i giocatori con ✅/❌. Flussi completi in
[docs/P2P.md](docs/P2P.md).

Le campagne che **hosti sono salvate automaticamente in locale** (snapshot senza password,
max 20): dalla tab 🗺️ Campagna le **riprendi** dalle sessioni scorse o le elimini — al
ripristino resta una sola voce (stesso id). La **password della campagna P2P è facoltativa**:
se vuota, entra chi ha il codice o l'indirizzo. Gestione completa (riprendi / rinomina / elimina
con conferma / sync col server) nella tab **💾 Campagne P2P**; il master può **espellere** i giocatori (🚫).

## Multiplayer (server self-hosted, opzionale)

Il server gira anche **in Docker con docker compose** ([docs/DOCKER.md](docs/DOCKER.md)) — HTTP/LAN oppure HTTPS su Internet con nginx come reverse proxy (certificati tuoi), **direttamente su Android via Termux** ([docs/ANDROID_SERVER.md](docs/ANDROID_SERVER.md)) o su un **server Debian con systemd** ([docs/DEPLOY_DEBIAN.md](docs/DEPLOY_DEBIAN.md)).

`npm run build -w @dnd5e/web && npm run server` → apre http://localhost:3001 con web app + WebSocket: campagne condivise master/giocatori, combattimento live con action economy (vedi [docs/SERVER.md](docs/SERVER.md)).

Ogni account può attivare la **2FA TOTP** (app authenticator, codici di backup) e registrare **passkey WebAuthn** per il login senza password (richiede HTTPS) — vedi [docs/SERVER.md](docs/SERVER.md). Account con **ruoli admin/user** (primo account o `DND5E_ADMIN_USER` è admin) e pannello `/admin`: approva utenti, promuovi/declassa, reset password, gestione campagne con **espelli giocatore**. **Libreria schede sincronizzata sull'account** (☁️ in Home) e **campagne P2P sincronizzabili** col server (tab 💾 Campagne P2P → ☁️).

## PWA (installabile da browser)

In produzione (`npm run build -w @dnd5e/web` + `vite preview`) il service worker è
registrato automaticamente: dal browser scegli "Aggiungi a schermata Home" / "Installa app".

## Aggiornamenti in-app 🔄

Il bottone 🔄 in alto a destra controlla l'ultima release GitHub e aggiorna senza uscire dall'app:
web/PWA (service worker + `/version.json`), desktop AppImage (download + sostituzione + riavvio, lato Rust),
Android APK (apre il download dell'asset). Dettagli in [docs/UPDATE.md](docs/UPDATE.md).

## Roadmap

Il P2P LAN è il nuovo punto di partenza: le prossime priorità (dettagli in
[docs/ROADMAP.md](docs/ROADMAP.md)) sono:

1. **Robustezza P2P + polish UX** ✅ (v0.1.53–0.1.68) — persistenza della campagna sull'host ("riprendi campagna"),
   **riconnessione automatica dopo un drop** (token identità + grace period + rientro automatico, badge "disconnesso"),
   chat di campagna, turno corrente evidente con avviso, onboarding al primo avvio e palette comandi Cmd-K;
   **setup al primo avvio** (nome/lingua/tema + server o "solo locale"), **login e scelta server in Home** con
   "mantieni l'accesso", server del login come default per campagne/sync, link account + pannello admin (solo admin).
   Sui server Docker (`DND5E_REQUIRE_AUTH=true`, default nei compose) **senza login non si accede al sito**; registrazione
   `open`/`approval` (`DND5E_REGISTRATION`); su webapp servita dal server niente P2P. `https`→`wss://` automatico
2. **Espansione gameplay** ✅ (v0.1.69–0.1.70) — mappa tattica con token trascinabili sincronizzata via P2P,
   party tracker del master sempre visibile, statistiche di campagna (danni/PF/round/uccisioni) + export
   campagna JSON + log per round, schede pregen clonabili da Home, generatore di dungeon casuale (master),
   negozio e crafting con calcolo automatico del resto; rework UI in tema D&D (placche dorate, serif, grigliettina)
3. **Piattaforme e dati** — PWA offline completa, notifiche push, import da D&D Beyond,
   sync cloud opzionale, iOS, test e2e Playwright

## Licenze

Contenuti SRD 5e sotto OGL 1.0a / CC-BY 4.0 (Wizards of the Coast). I contenuti non-SRD
vanno inseriti solo come custom dall'utente.
Icone del set "Lucide": [Lucide](https://lucide.dev), licenza ISC (Copyright © 2013–2025 Cole Bemis e contributori).

## Nota sicurezza

`npm audit` può segnalare avvisi high su tooling solo di sviluppo (vite/vitest/picomatch): i pacchetti sono tutti all'ultima versione; il runtime (bundle browser + server `ws`) non è coinvolto. Test: 184/184 verdi (root) + 24/24 UI jsdom + e2e Playwright e validazione PKGBUILD AUR in CI (job `e2e`, `aur`).
