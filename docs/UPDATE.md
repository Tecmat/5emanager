# Aggiornamenti in-app (check update)

L'app controlla da sola se esiste una release più recente su GitHub (`Tecmat/5emanager/releases/latest`)
e permette di aggiornare **senza sair dall'app**, con il bottone 🔄 in alto a destra (cerca automaticamente
all'avvio; il pallino arancione segnala che c'è una nuova versione).

## Web app / PWA (server self-hosted) — si aggiorna da sola, senza terminale

- La build scrive `public/version.json` (`{ version, build }`) → servito come `/version.json`.
- Ogni release pubblica anche **`web-dist.zip`** (asset della release GitHub).
- Il server espone **`POST /api/update/apply`**: scarica `web-dist.zip` dall'ultima release
  (con `GITHUB_TOKEN` se il repo è privato), fa backup di `dist/` in `dist.bak`, lo scompatta
  e ripristina il backup in caso di errore. Se `DND5E_ADMIN_TOKEN` è impostato, serve
  l'header `x-admin-token` (l'app lo chiede con un prompt).
- Dal pannello 🔄 della web app: **🔄 Aggiorna ora** → `POST /api/update/apply` → reload con
  service worker (`registration.update()` + `SKIP_WAITING`). Niente `git pull`/`npm run build`
  da terminale. Requisito: il processo del server deve poter scrivere in `apps/web/dist`
  (l'utente `5eapp` deve essere proprietario della cartella dell'app).
- Se l'endpoint non risponde (server vecchio), resta il fallback: confronto `/version.json` +
  reload del service worker dopo il redeploy manuale.

## Desktop (AppImage, Tauri)

- Il check lo fa il **processo Rust** (`check_update` in `src-tauri/src/lib.rs`, reqwest → GitHub API,
  confronto semver con la versione del pacchetto) e individua l'asset `*.AppImage` della release.
- **⬇️ Scarica e installa** (`download_update`): scarica il nuovo AppImage come `.5emanager-update.AppImage`
  **accanto all'eseguibile corrente**, con barra di progresso (evento `update-progress`).
- **▶ Riavvia ora** (`apply_update`): sostituisce l'AppImage in esecuzione con `rename` (su Linux è
  permesso anche a processo in corso), lo rende eseguibile e riavvia l'app. Non ritorna mai.
- Se la cartella dell'AppImage non è scrivibile, il download fallisce con un messaggio chiaro.

## Android (APK, Capacitor) — installa dentro l'app

- Il check confronta l'ultima release GitHub (o `/api/update` del server LAN) con la versione del bundle.
- **⬇️ Scarica e installa APK**: il plugin nativo `UpdateInstaller` (in `apps/web/android-overlay`,
  patchato in CI nel progetto generato da Capacitor) scarica l'APK in cache con barra di progresso
  e apre **subito il prompt di installazione di Android** (FileProvider + `ACTION_VIEW`).
  Se manca il permesso "installa app sconosciute", apre le impostazioni dell'app.
- Fallback se il plugin manca: apre il browser sull'APK (`@capacitor/browser`).
- L'asset APK si scarica via `browser_download_url` (repo pubblico) o via proxy
  `/api/update/asset?name=app.apk` del server (repo privato).

## iOS (IPA per sideload)

- La CI (macos-latest) builda `app-unsigned.ipa` (senza firma Apple): installalo con
  **AltStore** o **Sideloadly**, che firmano on-device con un Apple ID free.
- WebRTC su WKWebView iOS è supportato → P2P diretto e discovery funzionano. Fotocamera QR:
  `NSCameraUsageDescription` aggiunto via patch (`apps/web/ios-overlay/patch_ios.py`).

## Windows / macOS (portable)

- Release con `5e.Manager-windows-portable.zip` (bundle `app` Tauri zippato, niente installatore)
  e `5e.Manager-macos-arm64.zip` (`.app` zippato). Self-update su Windows/macOS: il check 🔄
  funziona (confronto release), il reemplazo automatico è implementato per Linux/AppImage.

## Repo GitHub privato

Se `Tecmat/5emanager` è **privato**, `api.github.com` e le pagine HTML di github.com rispondono
404 senza autenticazione. Tre modi, in ordine di preferenza:

1. **Server self-hosted con token** (consigliato per web + Android): imposta `GITHUB_TOKEN`
   (PAT fine-grained, Contents: read-only sul repo) nel servizio systemd (vedi
   `deploy/5emanager.service` e `docs/DEPLOY_DEBIAN.md`). Il server espone:
   - `GET /api/update` → ultima release `{ tag, pageUrl, assets }` (cache 5 min)
   - `GET /api/update/asset?name=<file>` → proxy del download dell'asset (streaming, con token)

   La web app servita dal server chiama `/api/update` sulla stessa origin; l'APK Android usa
   l'URL del server salvato nelle impostazioni (ws://… → http://…) e scarica l'APK via
   `/api/update/asset?name=app.apk`. **Nessun token finisce nel client.**
2. **Desktop**: token locale, cercato in quest'ordine: env `GITHUB_TOKEN` →
   `~/.config/emanager/github-token` → `gh auth token` (basta aver fatto `gh auth login`).
   Viene inviato come `Authorization: Bearer` sia alla API sia al download dell'asset.
3. Se il repo diventa pubblico, funzionano anche API/HTML senza token (fallback automatici).

In caso di errore il pannello 🔄 mostra il dettaglio (es. `HTTP 404`) e, se rileva un repo
privato, il suggerimento per configurare il token.

## Note

- Le release sono create automaticamente dal workflow `.github/workflows/release.yml` sui tag `v*`
  con asset AppImage/deb/rpm + APK: `releases/latest` è sempre l'ultima pubblica.
- La GitHub API anonima ha rate limit (60 richieste/ora per IP): per la web app bastano poche check
  per sessione; su desktop il check passa dal processo Rust.
- Confronto versioni in `packages/core/src/version.ts` (`compareVersions`/`isNewerVersion`, testato).
