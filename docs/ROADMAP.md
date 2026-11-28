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
- ✅ **Android: firma stabile degli APK in CI** (v0.1.58): keystore debug committato (`apps/web/android-overlay/debug.keystore`) iniettato come `signingConfigs.debug` da `patch_android.py` → stessa firma su ogni build, niente più `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (“app non installata” su Samsung); `patch_signing.py` inserisce `release` nel blocco `signingConfigs` esistente; test `android-patch.test.ts` su progetto Capacitor finto; procedura di migrazione nel runbook privato (non versionato)
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

- ✅ **Hardening per HTTPS pubblico** (v0.1.82): `/.well-known/security.txt` pubblico + `SECURITY.md`; `DND5E_ADMIN_ALLOWLIST` (IP/CIDR) su `/admin`/`adminAuth`/self-update (+`DND5E_TRUST_XFF` dietro proxy); rate limit configurabili `DND5E_REGISTER_MAX_ATTEMPTS`/`DND5E_INVITE_MAX_ATTEMPTS`; card 🔐 Sicurezza in `/admin` con warning admin senza 2FA + audit `admin-login-no-2fa` — test `hardening.test.ts`
- ✅ **Timer di turno sincronizzato** (v0.1.82): `turnTimerSec`/`turnStartedAt` in `CombatState` (impostato da `nextTurn`), azione master `setTurnTimer`, countdown identico per tutti in Campagna online (🌐) e timer in CombatTab locale — test `turn-timer.test.ts`
- ✅ **Gesture touch sulla mappa tattica** (v0.1.82): pinch-zoom + pan con due dita, pan con un dito, zoom rotella, reset vista in `TacticalMap.tsx` (viewBox dinamico)

- ✅ **Fix P2P sparito sulle app desktop (Tauri)** (v0.1.83): `isServerWebapp()` legge prima il marker esplicito `<meta name="dnd5e-server">` che il server inietta nell'HTML della webapp servita (CSP-safe, robusto su `tauri://`/`tauri.localhost`), poi un'euristica origin corretta (mai Tauri, mai vite 5173) — test `setup-gate.test.ts` + `login-page.test.ts`

- ✅ **Immagine server su GHCR** (v0.1.84): ogni release pusha `ghcr.io/tecmat/5emanager-server:<versione>` + `:latest` (job `docker-server` in release.yml); compose root e `docker/` usano quell'immagine di default → update = `docker compose pull && docker compose up -d`, niente build locale (`--build` resta per modifiche locali); hint aggiornati in `/admin` e nel messaggio 409 di `what=server`

- ✅ **Tab Account dedicata** (v0.1.85): account (login/logout, 2FA, passkey, libreria) spostato da Campagna a una tab propria (`AccountTab.tsx`) con card Sessione / Sicurezza / Libreria; link da Campagna e da Home ("Il mio account"); testi coerenti (niente più "Campagna → Account"), etichetta "Vai a Campagna" unificata — test `uiSettings.test.ts` aggiornati
- ✅ **Editor regole base (SRD)** (v0.1.85): card in Contenuti custom (`SrdEditorCard.tsx`) con categoria + filtro + editing JSON, validazione, ripristino originale, esporta/importa JSON; override persistenti (`dnd5e.srd.overrides.v1`) applicati sopra l'SRD nel registry a caldo — `srdOverrides.ts`, test `srdOverrides.test.ts`

- ✅ **Login con passkey anche dalla pagina /login** (v0.1.86): endpoint HTTP pubblici `/api/passkey/options` + `/api/passkey/verify` (challenge monouso 3 min, rate limit `DND5E_PASSKEY_MAX_ATTEMPTS`, audit `login-passkey`), pulsante 🔑 in `login.html` con client WebAuthn hand-rolled (niente libreria nel standalone); compose (root e docker/) ora passano `DND5E_RP_ID`/`DND5E_RP_ORIGIN` al container — test `passkey-http.test.ts` (6)

- ✅ **Coerenza UI/UX: niente più form account duplicati** (v0.1.88): la card "Server" in Home ora è compatta (picker server + stato: tag utente/ruolo/libreria/modalità + Vai a Campagna / Il mio account / Pannello admin; se non loggato, solo hint + pulsante Account) — login/registrazione/2FA/passkey/esci vivono solo nella tab Account
- ✅ **Rifiniture estetiche** (v0.1.88): icone allineate nei titoli card, striscia dorata della card che si accende on-hover, hover righe tabella più leggibile, ::selection e scrollbar tematizzate, bordo inferiore delle sezioni Home

- ✅ **Versionamento delle schede** (v0.2.0): snapshot persistenti per scheda (auto max 1/ora, manuali con etichetta, automatico prima del level-up) + ripristino/elimina — `versions.ts`, `VersionsCard.tsx`, hook in `store.tsx`
- ✅ **E2E multiplayer** (v0.2.0): server di gioco in CI (porta 3999) + host via UI e player via WS: join, scheda, XP del master — `e2e/multiplayer.spec.ts`, `playwright.config.ts`
- ✅ **Audit dati SRD in CI** (v0.2.0): validazione completa + conteggi (12 classi, ≥3 archetipi/classe, ≥100 incantesimi) — `packages/data-srd/test/audit.test.ts`
- ✅ **CHANGELOG pubblico + novità in-app** (v0.2.0): `CHANGELOG.md` + dialog "Novità della vX" al cambio versione — `news.ts`, `App.tsx`
- ✅ **Tira dado animato + suono opzionale** (v0.1.98): il totale "rotola" con valori casuali durante il tiro (rispetta `data-animations=off`) e click WebAudio opzionale con toggle 🔊/🔕 persistente — `DiceRoller.tsx`, `styles.css`
- ✅ **E2E Playwright: flusso PG completo** (v0.1.98): crea mago → +300 XP → level-up → lancia incantesimo → voce nel diario — `e2e/app.spec.ts`
- ✅ **Pronto per il Play Store** (v0.1.89): AAB release-signed `app.aab` in release (con keystore nei secret) oltre all'APK; self-update via APK **disabilitato su install Play** (`isPlayInstall` nel plugin → pulsante apre il Play Store, policy Google rispettata); `PRIVACY.md` + runbook Play (Data Safety, listing IT/EN, track — privato, non versionato); test `update-playstore.test.ts`

- ✅ **Restyling v0.1.90**: badge dorato con icona spade nell'header del brand (`brand-badge` in `App.tsx`), tab attive con pill piena e hover sulle inattive, hero Home più grande (titolo 30px), placeholder avatar con bordo e gradiente, hover del pulsante danger con glow rosso, tag "custom" delle sheet con accento — `styles.css`

- ✅ **AAB release-signed validato end-to-end (v0.1.91)**: con i 4 secret Android impostati (`ANDROID_KEYSTORE_B64` + password/alias), il job `android` della release firma `assembleRelease` e produce **`app.aab`** (asset Play Store) oltre a `app.apk` release-signed — `versionCode` automatico 191

- ✅ **Play Store: targetSdk 36 + R8 attivo (v0.1.92)**: `patch_android.py` porta il template a `compileSdk/targetSdk 36` (requisito Play 2026), AGP 8.13.0 + Gradle 8.14.2 + androidx Activity 1.10.1 / Core 1.16.0 / AppCompat 1.7.1; release con `minifyEnabled true` + `shrinkResources true` e `-keep class com.tecmat.emanager.**` per i plugin custom (bridge JS); CI installa `platforms;android-36` + `build-tools;36.0.0`
- ✅ **Fix crash all'avvio su build Play (v0.1.93)**: R8 troppo aggressivo (`proguard-android-optimize.txt`) poteva rompere bridge WebView/plugin a runtime → si usa il default non-ottimizzato `proguard-android.txt` (mapping.txt resta nell'AAB) + keep espliciti `com.tecmat.emanager.**` / `com.getcapacitor.**` / `org.nanohttpd.**` + `-keepattributes JavascriptInterface,...` + `-keepclassmembers @JavascriptInterface`; test `android-patch.test.ts` con fixture completo e caso minimo

### Fase 2 — espansione gameplay (medio termine)
- ✅ **Mappa tattica minimale** (v0.1.69): griglia 5 ft con token trascinabili (`TacticalMap.tsx`), stato in `combat.map` (`core/rules/combat.ts`: `ensureMap`/`moveToken`/`setMapSize`) e azioni `moveToken`/`setMapSize` in `core/campaign.ts` — sincronizzata via `state` su server e P2P; permessi: master sempre, PG solo il proprio token nel suo turno; ridimensionabile dal master; token auto-assegnati ad addEnemy; presente in combattimento live (Campagna) e locale (CombatTab); test in `campaign.test.ts`
- ✅ **Party tracker lato master sempre visibile** (v0.1.69): DM screen sempre attivo per il master (PF/CA/percezione passiva/intuizione/condizioni/esaurimento + badge disconnesso) + striscia compatta "Party" nell'header campagna con PF/CA di ogni PG anche fuori dal combattimento
- ✅ **Log per round + statistiche di campagna + export campagna intera** (v0.1.70): `Campaign.stats` (`DEFAULT_STATS`: attacchi / danni inflitti / danni subiti / PF curati / uccisioni / round, aggiornati in `applyCampaignAction` per `attack`, `damage`/`heal`, `masterDamage`/`masterHeal`, `nextTurn`); card 📊 "Statistiche di campagna" in Campagna + bottone 💾 "Esporta campagna (JSON)" (stato completo, `passwordHash` azzerato); log del combattimento esportabile in .txt con marker "▶️ Round N"; test in `shop.test.ts`
- ✅ **Schede pregen** (v0.1.70): `data-srd/data/pregen.json` (4 PG pronti, generati con `createCharacter` + `applyLevelUp`) esportati come `PREGEN_DATA` e clonabili da Home con un click (nuovo id via `uid`, apertura immediata della scheda)
- ✅ **Generatore di dungeon casuale** (v0.1.70): `randomDungeon` in `core/rules/random.ts` + `data-srd/data/dungeon.json` (nomi, 10 tipi di stanza con probabilità di trappola/mostri/tesoro, tabelle trappole/mostri/tesori) — bottone "Dungeon casuale" nella card 🎲 del master con elenco delle stanze; test con rng seeded in `shop.test.ts`
- ✅ **Negozio + crafting con calcolo del resto** (v0.1.70): `payCopper`/`copperToCurrency` (pagamento esatto in rame, rottura della moneta più piccola, resto restituito), `buyItem` (accoda se esiste già, altrimenti nuovo oggetto) e `craftItem`/`missingIngredients` (consumo ingredienti per nome + costo in MO) in `core/rules/inventory.ts`; tipi `ShopItem`/`CraftingRecipe` in core, `ItemKind` allargato a `consumable`/`ammo`/`scroll`; `data-srd/data/shop.json` + `crafting.json` esportati come `SHOP_DATA`/`CRAFTING_DATA`; card 🛒 Negozio e ⚒️ Crafting in Inventario con quantità, prezzo, resto e ingredienti mancanti; test in `shop.test.ts`
- ✅ **Rework UI in tema D&D** (v0.1.70): palette cuoio/parchment (dark caldo + light pergamena), font serif display per titoli e brand (`--font-display`), card "placca" con bordo dorato, header con bordo dorato, bottoni uniformi (raggio 8px, primary con gradiente oro), tabelle con intestazione dorata e righe alternate, grigliettina di sfondo sottile stile mappa; temi chiaro/scuro preservati (`styles.css`)

### Fase 3 — piattaforme e dati (visioni)
- ✅ **PWA offline completa + promemoria sessione** (v0.1.71): `sw.js` precache di shell/asset/icone/`version.json`, cache-first per JS/CSS (i chunk lazy includono i dati SRD), network-first per le pagine con fallback offline sulla shell, indicatore "⚠️ senza rete" in header; promemoria di sessione con Notification API (card 🔔 in Home: data/ora + testo, notifica alla scadenza anche con PWA installata, banner se scaduto ad app chiusa) — `reminder.ts`, `ReminderCard.tsx`, `App.tsx`
- ✅ **Import da D&D Beyond** (v0.1.71): `ddbImport.ts` best-effort su export JSON propri (nome, razza+sottorazza, classe, livello, caratteristiche; 12 classi e 9 razze SRD mappate EN/IT; livello ricostruito con PF medi e ASI/sottoclasse automatici; avvisi per multiclasse e campi non mappati) — bottone "Importa da D&D Beyond" in Home; test in `apps/web/test/uiSettings.test.ts`
- ✅ **Sync cloud opzionale** (v0.1.68): login multi-dispositivo con libreria schede sull'account (`saveCharacter` per id = last-write-wins), campagne P2P sincronizzabili sull'account
- ✅ **Test e2e Playwright** (v0.1.71): `playwright.config.ts` + `e2e/app.spec.ts` (flusso: setup → crea PG → tab scheda → tira dado; personalizzazione UI: palette + icone + tab nascoste), job CI `e2e` con Chromium headless (`npx playwright install --with-deps chromium`), script `npm run test:e2e`
- ✅ **Nginx rimosso completamente dal progetto** (v0.1.74): eliminati `docker/docker-compose.nginx.yml`, `docker/docker-compose.external-nginx.yml`, `docker/nginx/`, `deploy/nginx-external.conf`, `deploy/nginx-upgrade-map.conf` e i riferimenti in `.env.example`/`.gitignore`; resta solo il server su `:3001` (compose root + `docker/docker-compose.yml` + override `docker-compose.lan.yml`). Le doc (`docs/DOCKER.md` §2-3, `docs/DEPLOY_DEBIAN.md` §4, `docs/SERVER.md`) spiegano i requisiti del reverse proxy proprio (TLS + WebSocket upgrade + Host/X-Forwarded-Proto + timeout alti) con esempio Caddy e le env `DND5E_RP_ID`/`DND5E_RP_ORIGIN` per le passkey — l'utente sceglie liberamente proxy e servizio HTTPS
- ✅ **Fix "tab scomparse dopo update" (Windows/Tauri, v0.1.73)**: `loadUISettings` ora valida ogni campo di `dnd5e.ui.v1` (enum/colori hex/array) con self-heal — una chiave corrotta cade sui default invece di crashare il render; `applyUISettings` ignora colori non-hex e radius NaN; `orderTabs`/`moveId` sono a prova di input non-array; recovery `?resetui=1` in `main.tsx` + tasto "Ripristina impostazioni UI" nell'ErrorBoundary (cancella solo le chiavi UI, le schede in IndexedDB restano) — non serve più cancellare `AppData/Local/com.tecmat.5emanager`. Test in `uiSettings.test.ts` (+6)
- ✅ **Setup client solo sulle app, non sulla webapp del server** (v0.1.72): `shouldShowClientSetup` in `SetupPage.tsx` — sulla webapp servita dal Docker non appare la scelta "server remoto / solo locale" (il server è la pagina stessa; c'è il login require-auth e, lato server, il primo setup admin `/setup`); sulle app scaricate e in dev resta. Test `setup-gate.test.ts`
- ✅ **Pacchetto AUR `5emanager-bin`** (v0.1.72): `deploy/aur/` (PKGBUILD + .SRCINFO + desktop + icona) che installa l'AppImage ufficiale; il job `desktop` di `release.yml` pubblica anche l'asset con nome stabile `5emanager-<ver>-x86_64.AppImage`; job CI `aur` valida il PKGBUILD in container Arch; guida in `deploy/aur/README.md`
- ✅ **Personalizzazione interfaccia** (v0.1.71): tema auto/scuro/chiaro, 6 palette predefinite + colori custom (accent/accent2 via CSS var su `:root`), stile bordi morbido/squadrato/pill + raggio angoli, set icone "classiche" interne o **Lucide** (open source, ISC — `lucide-react`), riordino (↑↓) e mostra/nascondi delle **tab principali e delle tab della scheda**; scorciatoie 1-9 seguono l'ordine visibile; persistenza `dnd5e.ui.v1` applicata prima del primo render — `uiSettings.ts`, `tabs.ts`, `AppearanceCard.tsx`, `App.tsx`, `main.tsx`
- ✅ **iOS via Capacitor** (v0.1.71): job CI `ios` in `release.yml` (runner macos) builda un **IPA unsigned** per sideload (AltStore/Sideloadly) e lo allega alla release; guida firma/TestFlight/App Store in `docs/IOS.md` (`apps/web/ios` gitignored come `android`)

> Questa sezione riorganizza e dà priorità alle "idee P3" elencate più sotto.

## ✅ P1/P2 completate (v0.1.13, branch vibe/dnd5e-scheda-f0caaa)

- ✅ **P1 Upcast del danno**: `upcastExtraDice`/`spellDamagePreview` nel core (parse dell'`higherLevel`, es. +1d6/slot) — anteprima "a slot N°: danno X + Y" in tab Incantesimi e voce `upcast +NdM` nel diario al lancio
- ✅ **P1 XP a tutta la party**: azione `masterAddXpAll` (server + P2P) + bottone ⭐ nel pannello master
- ✅ **P1 Inventario di gruppo + tesoreria condivisa**: `Campaign.groupInventory`/`groupCurrency` con azioni `groupAddItem` (tutti), `groupRemoveItem`/`groupGiveItem`/`groupAddCurrency` (master), card 🎒 in Campagna; migrazione campagne existentes (`migrateCampaign`)
- ✅ **P1 Note di sessione condivise**: `Campaign.notes` + azione `setCampaignNote` (master), card 📝 in Campagna
- ✅ **P1 Reminder TS concentrazione**: `damageCombatant` logga `🎯 TS Cos CD max(10, metà danno)` quando un combattente concentrato subisce danni
- ✅ **P1 Preferiti incantesimi ⭐**: `Character.favoriteSpells` + stella per riga + filtro "solo ⭐" in Incantesimi
- ✅ **P2 Pergamene/oggetti che lanciano**: `InventoryItem.spellId` + `castItemSpell` (1 carica, nessuno slot, niente componenti materiali) + bottone ✨ in Inventario
- ✅ **P2 Template aree in combattimento**: cono/sfera/linea/cubo con misure in ft su griglia 5 ft (SVG `TemplateView`), azioni `setTemplate`/`clearTemplate` (master o turno corrente), in Combattimento locale e live
- ✅ **P2 Generatore casuale master**: `rules/random.ts` + `data-srd/data/random.json` (nomi, incontri e tesori per tier di livello) — card 🎲 in Campagna con "aggiungi nemici al combattimento" e "metti nel gruppo/tesoreria"
- ✅ **P2 Rarità/valore + vendita**: `rarity`/`valueGp` sugli oggetti, filtro per rarità, colonna valore, bottone 💰 vendi (+MO), "Tesoro totale" in Panoramica-inventario (`totalTreasureGp`)
- ✅ **P2 Undo**: snapshot in memoria (max 30) in `store.tsx`, bottone ↩ in header + **Ctrl/Cmd+Z**; shortcuts **1-6** cambiano tab, **E** edit on/off
- ✅ **P2 Editor incantesimi con preview danno medio** vs baseline SRD per livello + campo **upcast** con anteprima `+NdM per slot` (v0.1.98) — `CustomTab.tsx`, `validate.ts`
- ✅ **P2 Macro tira-dado salvate** (localStorage, chip cliccabili in Tira dado)
- ✅ **P2 Code-splitting**: tab in `React.lazy` + Suspense (chunk separati per tab) — `App.tsx`
- ✅ **P2 Accessibilità** (v0.1.98): `:focus-visible`, `prefers-reduced-motion`, `aria-current` sulle tab attive delle nav, aria-label sui bottoni solo-icona — `styles.css`, `App.tsx`
- ✅ **P2 Esporta log combattimento** (bottone 💾 in Campagna → .txt)
- i18n esteso a tutte le nuove UI (IT/EN)

## 💡 Idee nuove (P3 — proposte, da valutare insieme)

- ✅ **Log dei tiri del combattimento persistente** (v0.1.98): `rollHistory` in `CombatState` (cap 200, tiri di attacco/danno/initiative) + card 🎲 Tiri in `CombatLog.tsx` (locale e online) — test `roll-history.test.ts`
- ✅ Mappa tattica minimale con token trascinabili (griglia 5 ft, drag&drop)
- ✅ Beep/avviso sonoro opzionale al cambio turno (il timer c'è già)
- ✅ Crafting/ricette e compravendita con calcolo del resto
- ✅ Import base da D&D Beyond (parsing del JSON esportato dall'utente — solo dati propri)
- ✅ PWA offline completa (service worker che cachea anche i dati SRD)
- ✅ Notifiche promemoria sessione (v0.1.7x): notifica locale via Notification API su PWA installata (Android/desktop), permesso richiesto dalla card 🔔 — `reminder.ts`, `ReminderCard.tsx` (push server rimandato)
- iOS via Capacitor (stesso codice) — momentaneamente in pausa
- Sync cloud opzionale (login multi-dispositivo, conflitto last-write)
- ✅ Generatore di dungeon/stanze casuali (tabelle JSON, come il generatore incontri)
- ✅ Schede "pronte" (pregen) da sfogliare e clonare
- ✅ Esportazione campagna intera (log + schede + tesoreria) in un file
- ✅ Statistiche di campagna (danni totali, incantesimi lanciati, round) dal log

## ✅ P3 completate (dic 2026, branch vibe/dnd5e-scheda-f0caaa)

- ✅ **P2P semplificato**: codice invito come testo + **QR** + copia/condivisione nativa; flusso host→giocatore→host in 2 passi
- ✅ **Discovery P2P**: gli host si annunciano su un server LAN (`p2pAnnounce`, TTL 90 s) e i giocatori vedono la **lista degli host sulla rete** e si uniscono con un click (il server relay-a solo i codici SDP)
- ✅ Riposo breve con **dadi vita** (`shortRest` in core: PF = tiro + mod Cos per dado, risveglio da 0 PF, cap a PF max) + bottone in Panoramica
- ✅ **Slot equipaggiamento standard** (testa, amuleto, mantello, armatura, guanti, cintura, stivali, 2 anelli, scudo, 2 mani) con validazione: equipaggiare un oggetto libera lo slot (`setEquipped`/`setItemSlot`), warning conflitti (`equipConflicts`), armi in mano libera automatica
- ✅ **Simula il PG fino al 20** (`simulateTo20` in core: ASI automatico, archetipo/stile auto) + test su tutte le classi SRD + bottone 🧪 in tab Custom per validare anche le classi custom
- ✅ **Timer di turno** nel pannello combattimento (avvia/pausa/reset, reset automatico al cambio turno, secondi configurabili)
- ✅ **Tema automatico** dal sistema (`prefers-color-scheme`) se non c'è una scelta salvata
- ✅ Creazione PG migliorata: **stile di combattimento al liv 1** (guerriero) direttamente in creazione
- ✅ **42 archetipi** (3-4 per classe, 8 scuole del mago) in `subclasses-c.json`, selezionabili dal registro

## ✅ P0 completate (dic 2026, branch vibe/dnd5e-scheda-f0caaa)

- ✅ Esaurimento 1–6 con effetti automatici (core `rules/exhaustion.ts`: svantaggio prove, velocità, PF max dimezzati, morte a liv 6) + selettore in Panoramica
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
- ✅ **P1** **Background come entità SRD** — `backgrounds.json` (13 background, skill + feature), selettore in creazione che applica le competenze, nome risolto in Panoramica
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
- **P2** Import da **D&D Beyond** (parsing del JSON esportato) — solo i propri dati, nel rispetto del copyright

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
