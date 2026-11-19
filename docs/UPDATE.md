# Aggiornamenti in-app (check update)

L'app controlla da sola se esiste una release più recente su GitHub (`Tecmat/5emanager/releases/latest`)
e permette di aggiornare **senza sair dall'app**, con il bottone 🔄 in alto a destra (cerca automaticamente
all'avvio; il pallino arancione segnala che c'è una nuova versione).

## Web app / PWA (server self-hosted)

- La build scrive `public/version.json` (`{ version, build }`) → servito come `/version.json`.
- Al caricamento l'app confronta `/version.json` del server con la versione locale salvata e chiede
  l'aggiornamento del **service worker** (`registration.update()` + `SKIP_WAITING` + reload).
- Dopo aver deployato una nuova build sul server (`git pull && npm ci && npm run build -w @dnd5e/web`),
  i client vedono il banner "Nuova versione disponibile" al prossimo caricamento → **🔄 Aggiorna ora**.

## Desktop (AppImage, Tauri)

- Il check lo fa il **processo Rust** (`check_update` in `src-tauri/src/lib.rs`, reqwest → GitHub API,
  confronto semver con la versione del pacchetto) e individua l'asset `*.AppImage` della release.
- **⬇️ Scarica e installa** (`download_update`): scarica il nuovo AppImage come `.5emanager-update.AppImage`
  **accanto all'eseguibile corrente**, con barra di progresso (evento `update-progress`).
- **▶ Riavvia ora** (`apply_update`): sostituisce l'AppImage in esecuzione con `rename` (su Linux è
  permesso anche a processo in corso), lo rende eseguibile e riavvia l'app. Non ritorna mai.
- Se la cartella dell'AppImage non è scrivibile, il download fallisce con un messaggio chiaro.

## Android (APK, Capacitor)

- Il check confronta l'ultima release GitHub con la versione della build (`/version.json` nel bundle).
- **⬇️ Scarica APK** apre il browser di sistema (`@capacitor/browser`) direttamente sull'asset `.apk`
  della release: al termine del download basta toccare il file per installare (come per qualsiasi
  sideload APK).

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
   `/api/update/asset?name=app-debug.apk`. **Nessun token finisce nel client.**
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
