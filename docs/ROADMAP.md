# Roadmap — espansione di 5e Manager

## 🔜 Prossime priorità — post P2P LAN (v0.1.52+, proposte da discutere insieme)

Il multiplayer P2P sulla stessa WiFi funziona (scoperta LAN, codice invito/QR, beacon, relay).
Prossimo blocco di lavoro, in ordine di valore/costo. Ogni voce indica dove si innesta:
`packages/core` (regole/campagna), `apps/web` (UI + `p2p.ts`/`netStore.tsx` per il trasporto),
`packages/server` (relay/announce), `data-srd` (dati).

### Fase 1 — robustezza P2P + polish UX (alto valore, basso costo)
- ✅ **Persistenza campagne P2P sull'host** (v0.1.53): snapshot automatico in IndexedDB (max 20, **senza password**) + lista "Riprendi / Elimina" nella tab Campagna; `resumeCampaign` nel core con test, `existing` negli host P2P (RTC/relay/LAN) — `p2pSaved.ts`, `p2p.ts`, `CampaignTab.tsx`
- ✅ **Ripristino a id stabile + password P2P facoltativa** (v0.1.54): `resumeCampaign` mantiene l'id (una sola voce per campagna nella lista salvati); join senza controllo password se l'host non l'ha impostata (P2PHost/P2PRelayHost/P2PLanHost)
- ✅ **Esporta PDF senza pop-up** (v0.1.54): `printSheet` stampa da iframe nascosto invece di `window.open` (bloccato su WebView Android / WebKitGTK Tauri) — `pdf.ts`
- ✅ **Scansione QR con preview** (v0.1.54): overlay fotocamera in-app che si chiude da solo al riconoscimento; fallback sull'app fotocamera di sistema (`input capture="environment"`) se BarcodeDetector/getUserMedia mancano — `qr.ts`
- ✅ **Fix plugin Android invisibili (UpdateInstaller/LanBeacon)** (v0.1.54): il template Capacitor 7 genera `MainActivity` senza `onCreate`, quindi il fallback della patch registrava i plugin DOPO `super.onCreate` (invisibili alla WebView → "plugin mancante"); ora registrati prima + assert che blocca la CI se l'ordine è sbagliato — `patch_android.py` (testato su template finto, idempotente)
- ✅ **Tab dedicata "💾 Campagne P2P"** (v0.1.55): gestione snapshot (riprendi via segnale cross-tab / rinomina / **elimina con conferma** / ☁️ sync sull'account server) — `P2PCampaignsTab.tsx`, `p2pSaved.ts`
- ✅ **Kick giocatore** (v0.1.55): `kickPlayer` nel core (solo master, no self-kick) + disconnessione immediata su server e host P2P (RTC/relay/LAN) + 🚫 nel pannello master e nel `/admin` — test core + server
- ✅ **Avvisi richiesta join P2P** (v0.1.55): "📨 inviata" all'invio, ack `joinPending`/`p2pJoinSent` quando arriva all'host → "✅ in attesa del master"
- ✅ **Ruoli admin sul server** (v0.1.55): `role` sugli account (v4, `DND5E_ADMIN_USER`, primo account admin), `adminSetRole`/`adminResetPassword`/`adminCampaignDetail`/`adminKickPlayer`, login admin → pannello senza token; UI in `admin.html`; test `roles.test.ts`
- ✅ **Sync remoto first-class** (v0.1.55): libreria schede in Home (☁️ salva tutte / scarica tutte / per-scheda) + campagne P2P sull'account (`saveP2PCampaign`/`deleteP2PCampaign`)
- ✅ **Self-update desktop Windows/macOS** (v0.1.56): prima il check prendeva sempre l'AppImage e il rename sull'exe in esecuzione falliva su Windows (riavvio ma versione vecchia); ora asset per-SO (`pick_release_asset`), su Windows estrazione zip via PowerShell + batch staccato che copia i file a processo uscito e riavvia, su macOS swap del .app via script — `src-tauri/src/lib.rs`, `update.ts`
- ✅ **2FA TOTP** (v0.1.57): RFC 6238 puro (`node:crypto`, test vettori RFC) — setup con QR otpauth + 8 codici backup (hash), login in 2 passi (`totpRequired` → `loginTotp`/`loginTotpBackup` monouso), throttle 5/min, disattiva con password; UI in Campagna → Account; test `totp-flow.test.ts`
- ✅ **Android: diagnostica pre-installazione APK** (v0.1.57): il plugin `UpdateInstaller` valida prima di aprire il prompt (magic PK, `getPackageArchiveInfo`, no downgrade versionCode, **firma confrontata con l'app installata**) e scarica su `.part` + rename — “app non installata” su Samsung diventa un errore chiaro (tipico: debug-signed vs release-signed); CI avvisa se manca il keystore (Play Protect)
- ✅ **Android: firma stabile degli APK in CI** (v0.1.58): keystore debug committato (`apps/web/android-overlay/debug.keystore`) iniettato come `signingConfigs.debug` da `patch_android.py` → stessa firma su ogni build, niente più `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (“app non installata” su Samsung); `patch_signing.py` inserisce `release` nel blocco `signingConfigs` esistente; test `android-patch.test.ts` su progetto Capacitor finto; docs migrazione in `docs/PLAY_PROTECT.md`
- ✅ **Passkey WebAuthn** (v0.1.59): login passwordless (`@simplewebauthn/server` v13) — registrazione passkey sull'account (max 10, counter anti-replay in `accounts.data` v6), login con o senza username (discoverable), la passkey vale come 2FA (niente TOTP in più), throttle 5/min, gestione chiavi in Campagna → Account; richiede HTTPS (secure context), RP ID/origin da `DND5E_RP_ID`/`DND5E_RP_ORIGIN`; test `passkeys.test.ts`
- ✅ **Deploy HTTPS pronto all'uso + fix wss://** (v0.1.60): la web app deriva ora `wss://` quando la pagina è in https (prima sempre `ws://` → mixed-content bloccato dietro nginx); compose nginx imposta `DND5E_RP_ID`/`DND5E_RP_ORIGIN` dal dominio (passkey); `deploy/smoke-test.sh` (index, /version.json, /api/info, /admin, handshake WS 101, redirect 301); guida passo-passo VPS+dominio+certbot in `docs/DOCKER.md`; test `net-ws-url.test.ts`
- ✅ **Deploy: .env non più tracciato** (v0.1.62): `docker/.env` rimosso dal repo (resta solo `.env.example` + `.gitignore` per `.env`, `data/`, `certs/`, `certbot-webroot/`) → niente più conflitti ai `git pull` dopo aver impostato dominio/token; docs aggiornati a `cp .env.example .env`
- ✅ **Deploy con nginx esterno** (v0.1.63): `docker/docker-compose.external-nginx.yml` (server solo su `127.0.0.1:3001` + env passkey dal dominio) + snippet host nginx pronti (`deploy/nginx-external.conf` + `deploy/nginx-upgrade-map.conf` per l'upgrade WebSocket) + guida in `docs/DOCKER.md` §2b
- ✅ **Server remoto: setup iniziale + admin panel statistiche** (v0.1.64): entrypoint Docker genera `DND5E_ADMIN_TOKEN` (log + `/data/admin-token.txt`); `/setup` + `POST /api/setup` creano il primo admin (bloccato dopo, protetto da token); `auth` ora include `role` e l'app mostra 🛡️ Pannello admin agli admin (link `/admin` ↔ `⬅️ App`); pannello con login count/ultimo login/2FA/passkey/P2P per utente, schede per campagna, totali server, azioni `adminDisableTotp`/`adminClearPasskeys`; **fix EXDEV** nel self-update web su overlayfs Docker (`moveDir` con fallback a copia); test `setup-exdev.test.ts`
- ✅ **LAN IP reale in Docker** (v0.1.66): dentro il container `networkInterfaces()` vede solo il bridge 172.x → nuova env `DND5E_LAN_IP`/`DND5E_LAN_IPS` (passata da tutti i compose via `.env`) così `/api/info` e i log annunciano l'IP LAN giusto (es. 192.168.1.36) alla scansione LAN delle app; test in `setup-exdev.test.ts`
- ✅ **Setup primo avvio + login in Home + server di default + require-auth Docker** (v0.1.68): pagina di setup al primo avvio (`SetupPage`, `dnd5e.setup.v1`: nome/lingua/tema + server ws/wss o "solo locale"); card "Server e account" in Home con scelta server (https→wss automatico via `toWsUrl`), login con **mantieni l'accesso** (remember token persistente, auto-login `loginToken` al riavvio) e link "Il mio account" + "Pannello admin" (solo admin); se loggato il server del login è il default per campagne/sync; server: `DND5E_REQUIRE_AUTH=true` (default nei compose Docker) → senza login il sito serve solo la pagina di login (`public/login.html`, cookie `dnd5e_session`, API `/api/login|login-token|register|logout|me`) e sui WS serve la sessione; `DND5E_REGISTRATION=open|approval` (env + `adminSetRegistration` in `/admin`, esposto in `/api/info`); su webapp servita dal server la sezione P2P è nascosta (`isServerWebapp`); test `auth-gate.test.ts` + `toWsUrl`
- ✅ **Riconnessione automatica** (v0.1.67): token identità persistente per campagna (localStorage) inviato in create/join; sul drop il server/host marca il giocatore `online: false` con grace period (60s, `DND5E_REJOIN_GRACE_MS`) invece di rimuoverlo subito, e il client rientra da solo con backoff (fase `reconnecting`, badge in header) senza reinserire la password — stesso playerId e scheda; kick/leave invalidano il token; badge 🔌 "disconnesso" in lobby, DM screen e pannello master; P2P: grace sugli host RTC/relay/LAN + rientro col token (`getP2PRejoinToken`) e auto-reconnect del client LAN — `core/campaign.ts` (`setPlayerOnline`), `netStore.tsx`, `p2p.ts`, `packages/server` (rejoinTokens + `p2pPeerGone`); test `rejoin.test.ts` + core
- ✅ **Chat di campagna** (v0.1.65): nuova azione `chat` in `core/campaign.ts` (cap 200 messaggi, sanifica, autore+ora) condivisa server WS e P2P — card 💬 in Campagna online con invio su Invio; test in `campaign.test.ts`
- ✅ **Turno evidente** (v0.1.65): riga del combattente di turno con outline animato, tag “⚔️ È il tuo turno!” e beep WebAudio (niente asset) quando inizia il tuo turno, con toggle 🔔 suono (persistente in localStorage)
- ✅ **Polish UI** (v0.1.61): onboarding primo avvio wizard 3 passi (nome/razza/classe → punteggi array-standard o 4d6 → crea, con Salta/Form completo), palette comandi **Ctrl/Cmd+K** con filtro e tastiera (↑↓+Invio), skeleton di caricamento, empty state Home con CTA, banner di errore con pulsante chiudi; test jsdom `polish.test.tsx`

### Fase 2 — espansione gameplay (medio termine)
- ✅ **Mappa tattica minimale** (v0.1.69): griglia 5 ft con token trascinabili (`TacticalMap.tsx`), stato in `combat.map` (`core/rules/combat.ts`: `ensureMap`/`moveToken`/`setMapSize`) e azioni `moveToken`/`setMapSize` in `core/campaign.ts` — sincronizzata via `state` su server e P2P; permessi: master sempre, PG solo il proprio token nel suo turno; ridimensionabile dal master; token auto-assegnati ad addEnemy; presente in combattimento live (Campagna) e locale (CombatTab); test in `campaign.test.ts`
- ✅ **Party tracker lato master sempre visibile** (v0.1.69): DM screen sempre attivo per il master (PF/CA/percezione passiva/intuizione/condizioni/esaurimento + badge disconnesso) + striscia compatta "Party" nell'header campagna con PF/CA di ogni PG anche fuori dal combattimento
- **Log del combattimento persistente per round** + **statistiche di campagna** (danni totali, incantesimi lanciati, round) + **export campagna intera** (log + schede + tesoreria) in un file
- **Schede pregen** da sfogliare e clonare
- Nuovi contenuti: **generatore di dungeon/stanze casuali** (tabelle JSON, come `random.json`), **crafting/ricette**, **compravendita con calcolo del resto**

### Fase 3 — piattaforme e dati (visioni)
- **PWA offline completa** (dati SRD cachati nel service worker) + **notifiche push** promemoria sessione (Android/desktop)
- **Import da D&D Beyond** (parsing del JSON esportato dall'utente — solo dati propri) + **sync cloud opzionale** (login multi-dispositivo, conflitto last-write-wins)
- **iOS via Capacitor**, **test e2e Playwright** (flusso: crea PG → XP → level-up → lancia incantesimo), copertura core > 90%

> Questa sezione riorganizza e dà priorità alle "idee P3" elencate più sotto.

## ✅ P1/P2 completate (v0.1.13, branch vibe/dnd5e-scheda-f0caaa)

- **P1 Upcast del danno**: `upcastExtraDice`/`spellDamagePreview` nel core (parse dell'`higherLevel`, es. +1d6/slot) — anteprima "a slot N°: danno X + Y" in tab Incantesimi e voce `upcast +NdM` nel diario al lancio
- **P1 XP a tutta la party**: azione `masterAddXpAll` (server + P2P) + bottone ⭐ nel pannello master
- **P1 Inventario di gruppo + tesoreria condivisa**: `Campaign.groupInventory`/`groupCurrency` con azioni `groupAddItem` (tutti), `groupRemoveItem`/`groupGiveItem`/`groupAddCurrency` (master), card 🎒 in Campagna; migrazione campagne existentes (`migrateCampaign`)
- **P1 Note di sessione condivise**: `Campaign.notes` + azione `setCampaignNote` (master), card 📝 in Campagna
- **P1 Reminder TS concentrazione**: `damageCombatant` logga `🎯 TS Cos CD max(10, metà danno)` quando un combattente concentrato subisce danni
- **P1 Preferiti incantesimi ⭐**: `Character.favoriteSpells` + stella per riga + filtro "solo ⭐" in Incantesimi
- **P2 Pergamene/oggetti che lanciano**: `InventoryItem.spellId` + `castItemSpell` (1 carica, nessuno slot, niente componenti materiali) + bottone ✨ in Inventario
- **P2 Template aree in combattimento**: cono/sfera/linea/cubo con misure in ft su griglia 5 ft (SVG `TemplateView`), azioni `setTemplate`/`clearTemplate` (master o turno corrente), in Combattimento locale e live
- **P2 Generatore casuale master**: `rules/random.ts` + `data-srd/data/random.json` (nomi, incontri e tesori per tier di livello) — card 🎲 in Campagna con "aggiungi nemici al combattimento" e "metti nel gruppo/tesoreria"
- **P2 Rarità/valore + vendita**: `rarity`/`valueGp` sugli oggetti, filtro per rarità, colonna valore, bottone 💰 vendi (+MO), "Tesoro totale" in Panoramica-inventario (`totalTreasureGp`)
- **P2 Undo**: snapshot in memoria (max 30) in `store.tsx`, bottone ↩ in header + **Ctrl/Cmd+Z**; shortcuts **1-6** cambiano tab, **E** edit on/off
- **P2 Editor incantesimi con preview danno medio** vs baseline SRD per livello (CustomTab)
- **P2 Macro tira-dado salvate** (localStorage, chip cliccabili in Tira dado)
- **P2 Code-splitting**: tab in `React.lazy` + Suspense (chunk separati per tab)
- **P2 Accessibilità**: `:focus-visible`, `prefers-reduced-motion`, aria-label su bottoni icona e tab
- **P2 Esporta log combattimento** (bottone 💾 in Campagna → .txt)
- i18n esteso a tutte le nuove UI (IT/EN)

## 💡 Idee nuove (P3 — proposte, da valutare insieme)

- Log dei tiri del combattimento persistente per round (estendere `combat.log` con storico separato)
- Mappa tattica minimale con token trascinabili (griglia 5 ft, drag&drop)
- Beep/avviso sonoro opzionale al cambio turno (il timer c'è già)
- Crafting/ricette e compravendita con calcolo del resto
- Import base da D&D Beyond (parsing del JSON esportato dall'utente — solo dati propri)
- PWA offline completa (service worker che cachea anche i dati SRD)
- Notifiche push promemoria sessione (Android/desktop)
- iOS via Capacitor (stesso codice) — momentaneamente in pausa
- Sync cloud opzionale (login multi-dispositivo, conflitto last-write)
- Generatore di dungeon/stanze casuali (tabelle JSON, come il generatore incontri)
- Schede "pronte" (pregen) da sfogliare e clonare
- Esportazione campagna intera (log + schede + tesoreria) in un file
- Statistiche di campagna (danni totali, incantesimi lanciati, round) dal log

## ✅ P3 completate (dic 2026, branch vibe/dnd5e-scheda-f0caaa)

- **P2P semplificato**: codice invito come testo + **QR** + copia/condivisione nativa; flusso host→giocatore→host in 2 passi
- **Discovery P2P**: gli host si annunciano su un server LAN (`p2pAnnounce`, TTL 90 s) e i giocatori vedono la **lista degli host sulla rete** e si uniscono con un click (il server relay-a solo i codici SDP)
- Riposo breve con **dadi vita** (`shortRest` in core: PF = tiro + mod Cos per dado, risveglio da 0 PF, cap a PF max) + bottone in Panoramica
- **Slot equipaggiamento standard** (testa, amuleto, mantello, armatura, guanti, cintura, stivali, 2 anelli, scudo, 2 mani) con validazione: equipaggiare un oggetto libera lo slot (`setEquipped`/`setItemSlot`), warning conflitti (`equipConflicts`), armi in mano libera automatica
- **Simula il PG fino al 20** (`simulateTo20` in core: ASI automatico, archetipo/stile auto) + test su tutte le classi SRD + bottone 🧪 in tab Custom per validare anche le classi custom
- **Timer di turno** nel pannello combattimento (avvia/pausa/reset, reset automatico al cambio turno, secondi configurabili)
- **Tema automatico** dal sistema (`prefers-color-scheme`) se non c'è una scelta salvata
- Creazione PG migliorata: **stile di combattimento al liv 1** (guerriero) direttamente in creazione
- **42 archetipi** (3-4 per classe, 8 scuole del mago) in `subclasses-c.json`, selezionabili dal registro

## ✅ P0 completate (dic 2026, branch vibe/dnd5e-scheda-f0caaa)

- Esaurimento 1–6 con effetti automatici (core `rules/exhaustion.ts`: svantaggio prove, velocità, PF max dimezzati, morte a liv 6) + selettore in Panoramica
- Tiri della morte a click in Panoramica a 0 PF (✓/✗, risveglio a 1 PF, 💀)
- Bonus attacco incantesimo e CD mostrati in Panoramica per ogni classe lanciante (`spellcastingInfoAll`)
- Lancio rituale senza slot (🕯 in tab Incantesimi) + consumo componenti materiali dall'inventario (cariche o quantità)
- Preparazione incantesimi separata per classe (`spellsPreparedByClass`, UI multiclasse)
- Inventario: ricerca, filtri (tipo/magico/equipaggiato), ordinamento, cariche (−/+ /⟳ /imposta), contenitori annidati con peso ricorsivo anti-ciclo
- Mini-DSL effetti (`rules/effects.ts`): `+N CA`, `advantage: saves vs magic`, `+1d6 fire damage`, `proficiency: skill stealth`, resistenze, speed, darkvision, max hp — applicato in derived/combat; editor talenti lo usa
- Editor UI contenuti custom strutturato: nemici (statblock), talenti, razze, archetipi, classi (con anteprima progressione 1–20) + export/import `.5epack`
- DM screen compatto per il master (PF, CA, percez./intuizione passive, condizioni, esaurimento)
- Storage: schede e custom su **IndexedDB** (wrapper hand-rolled, zero dipendenze) con fallback/migrazione da localStorage; export/import intera libreria (`.json`)
- i18n IT/EN base (`i18n.ts`, selettore 🌐 in header, cablato su App + CreateForm)

## ✅ Già implementato (nov 2026)

- **Server multiplayer self-hosted** (`packages/server`, WS + campagne JSON, docs/SERVER.md) — fase 2
- **Combattimento live con action economy** (azione/bonus/reazione/movimento, attaques vs CA, durate condizioni in round) — core + server + tab Campagna — fasi 1–3
- **Statblock nemici** (`enemies.json`: goblin, orco, lupo, scheletro, bandito, ogre) + addEnemy dal master
- Tab "🌐 Campagna": crea/unisciti, carica scheda locale, pannello master, log
- Tema chiaro/scuro, toggle ispirazione
- CI GitHub Actions (test/typecheck/build) + release su tag `v*` (web, Tauri, APK)

---

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
- ✅ **P1** **Diario di sessione / note con timestamp** (log automatico: XP, level-up, danni subiti)
- ✅ **P1** Esportazione scheda in **PDF stampabile** (CSS print + `window.print()`)
- **P1** Background e talenti come entità vere (oggi solo testo) — `data-srd` + selettori
- ✅ **P2** Cronologia con **undo** (snapshot dello stato prima di ogni azione)

## 2. Incantesimi (core/spells + web)

- **P0** Mostra **bonus attacco incantesimo** e **CD TS incantesimo** (8 + prof + mod) in Panoramica
- **P0** Preparazione separata **per classe** (multiclasse) invece che globale
- **P0** **Tracciamento componenti materiali** (consumabili con cariche, es. "diamante worth 500gp")
- **P0** Ritual casting: lanzio come rituale senza slot (10 min extra)
- ✅ **P1** Upcast automatico del danno (tabella `higherLevel` numerica, es. `+1d6/slot`) e pokazarlo nel lancio
- ✅ **P1** Concentration tracker nel tab Combattimento (chi sta concentrando cosa, reminder TS Con)
- ✅ **P1** Liste incantesimo custom per PG ("i miei preferiti", filtri per scuola/livello già presenti)
- ✅ **P2** Pergamene e oggetti che lanciano incantesimi (charges) nell'inventario

## 3. Combattimento (core/combat + web)

- **P0** Initiative automatica = 1d20 + mod Des del PG (oggi è un tiro cieco)
- **P0** **Durata delle condizioni in round** (es. "stordito 2 round") con decremento automatico a ogni turno
- **P0** Quick-toggles **vantaggio/svantaggio** applicati al prossimo tiro del tira-dado
- **P1** **Statblock nemici custom** (nome, CA, HP, attaques con dado e bonus) salvabili in `data-srd`-like JSON e riutilizzabili
- **P1** Log dei tiri del combattimento (history persistente per round)
- **P1** Tracker PF di tutto il gruppo (party) lato master
- ✅ **P1** Aree/zone (cono/sfera/linea) con mesures in griglia — toggle "mostratemplate"
- **P2** Timer di turno, musik/ambient, mappa tattica minimale con token trascinabili

## 4. Inventario (core/inventory + web)

- **P0** **Ricerca e filtri** (per tipo, magico, equipaggiato) + ordinamento colonne
- **P0** Oggetti **consumabili con cariche/usi** (pozioni, munizioni, batterie di bacchette)
- **P0** **Contenitori** (zaino dentro zaino) con peso ricorsivo
- **P1** Slot equipaggiamento standard (testa, amuleto, anelli x2, armatura, scudo, 2 mani...) con validazione equip
- ✅ **P1** Rarità e valore singamente, filtro per rarità, totale del tesoro
- ✅ **P2** Crafting/ricette, transactions con PNG (compra/vendi con calcolo resto)

## 5. Contenuti custom — editor avanzato (il cuore della "drastica" espansione)

- **P0** Editor UI completo per **classi** (form strutturato al posto del JSON a mano) + anteprima progressione
- **P0** Editor per **archetipi, razze, talenti, background, nemici (statblock)**
- **P0** **Mini-DSL degli effetti** interpretato dal core: `+1 CA`, `advantage: saves vs magic`, `+1d6 fire damage`, `proficiency: skill stealth`... (`core/rules/effects.ts` nuovo, `derived.ts` lo applica)
- **P1** **Pacchetti custom esportabili/importabili** (un file `.5epack` JSON con tutto: classi, incantesimi, nemici) — share tra giocatori
- **P1** Validazione "simula il personaggio" (test automatico che un PG custom sale di livello senza errori fino al 20)
- ✅ **P2** Editor di incantesimi con preview del danno medio e confronto con il baseline SRD

## 6. Campagna / strumenti master (nuovo `packages/campaign`?)

- **P0** **Multi-personaggio**: più schede nella stessa app, switch rápido (party)
- **P0** **DM screen**: vista compatta con PG, PF, CA, TS passivi, condizioni — per il master
- ✅ **P1** Inventario di gruppo condiviso + tesoreria di gruppo
- ✅ **P1** Assegnazione XP di sessione a tutta la party + note di sessione condivise
- ✅ **P2** Generatore casuale (nomi, incontri, tesori) con tabelle in JSON

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
- ✅ **P1** Scorciatoie da tastiera, comandi rapidi (cmd-K palette)
- **P1** Animazioni tiro dado, suoni opzionali
- ✅ **P2** Accessibilità completa (screen reader, contrasto WCAG, riduzione movimento)

## 10. Qualità

- **P1** Test e2e con **Playwright** (flusso: crea PG → XP → level-up → lancia incantesimo)
- **P1** Copertura core > 90% (oggi 39 test unit)
- ✅ **P2** Performance: virtualizzazione liste lunghe (grimorio 100+ incantesimi), code-splitting per tab

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
