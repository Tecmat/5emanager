# Pubblicare 5e Manager su Google Play Store

Prerequisiti già pronti nel repo: appId `com.tecmat.emanager`, `versionCode` automatico dalla versione
(`0.1.88` → `188`, monotono), `targetSdk 36` (requisito Play Store), icone adattive, CI che produce `app.apk` (sideload) e —
con il keystore nei secret — **`app.aab` release-signed** (l'asset per Play).

## 1) Secret GitHub (una volta sola)
Crea l'upload keystore e mettilo nei secret Actions del repo (vedi `docs/PLAY_PROTECT.md`):
`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Da quel momento ogni release allega `app.aab` (AAB release-signed) oltre a `app.apk`.

## 2) Play Console
1. Crea l'app: nome **5e Manager**, package `com.tecmat.emanager`, lingua default IT, tipo "App".
2. **Play App Signing**: carica il tuo upload keystore (`keystore.jks`) — Google firma con la sua app
   signing key. (Conserva il keystore: serve per ogni upload futuro.)
3. **Privacy policy**: incolla l'URL `https://github.com/Tecmat/5emanager/blob/main/PRIVACY.md`
   (vedi `PRIVACY.md`).
4. **Data Safety** (risposte consigliate):
   - Raccolta dati: **No** (niente raccolta/trasmissione a server terzi; i dati restano on-device o sul
     server self-hosted dell'utente).
   - Fotocamera: sì, **facoltativa**, solo per scansione QR; non in background; non raccolta.
   - `REQUEST_INSTALL_PACKAGES`: usado solo nelle build sideload per self-update da GitHub releases;
     **disabilitato nella build Play** (gli update arrivano solo da Play). Dichiaralo con questa motivazione.
   - Sicurezza: crittografia in transito (HTTPS/WSS verso il server dell'utente); in LAN http/ws su IP privati.
5. **Dichiarazione permessi/content rating**: compila il questionario IARC (app di utilità, senza contenuti
   sensibili: parliamo di D&D ma non c'è violenza grafica/utenti reali — materiali SRD sotto OGL, niente UGC).
6. **Accesso app / test**: nessuna area riservata; fornisci un account demo se richiesto.

## 3) Store listing
- **Titolo**: `5e Manager` · **Breve descrizione** (IT): "Gestore di schede D&D 5e: fiches, incantesimi, combattimento con mappa tattica, campagne multiplayer (server tuo o P2P in LAN)."
- **Descrizione lunga**: vedi sotto (IT + EN da tradurre in Console).
- **Icona**: 512×512 PNG (`apps/web/android-overlay/icons/icon-master.png`).
- **Feature graphic**: 1024×500 (da generare — screenshot dell'app in tema scuro con logo).
- **Screenshot**: almeno 2 per telefono (Home con schede, Combattimento con mappa tattica): catturali con
  `adb shell screencap` o dall'emulatore, in tema scuro.

### Descrizione lunga (IT)
> 5e Manager è il gestore di schede per D&D 5e che non ti fa più aprire il manuale: scheda personaggio completa
> (caratteristiche, competenze, PF, CA, punti ferita), incantesimi con slot e upcast, inventario con
> negozio e crafting, combattimento a turni con mappa tattica 5 ft e timer di turno, diario e statistiche di
> campagna. Multiplayer: campagne online sul TUO server self-hosted (Docker, anche su HTTPS) oppure P2P
> diretto in LAN (QR/codice invito, niente server). Login con 2FA (TOTP) o passkey, modalità di registrazione
> aperta/con approvazione/solo su invito, pannello admin con audit log. I dati restano sul tuo dispositivo
> o sul tuo server: privacy by design (vedi PRIVACY.md). Contenuti SRD 5e sotto OGL 1.0a.

## 4) Upload e track
1. **Testing interno** → carica `app.aab` dalla release GitHub (`vX.Y.Z` → asset `app.aab`).
2. Verifica: install da Play su un dispositivo tester, login, campagna P2P/server, passkey (HTTPS), QR.
3. **Produzione**: promuovi la release dopo i test; `versionCode` sale da solo a ogni tag.

## 5) Note importanti
- Su Play il **self-update via APK è disabilitato** (policy Google): il pulsante update apre il Play Store
  (`isPlayInstall` nel plugin `UpdateInstaller`). Le build sideload (GitHub `app.apk`) continuano ad
  auto-aggiornarsi come prima.
- `usesCleartextTraffic` resta attivo **solo per la LAN** (server/host P2P su IP privati); su Internet
  l'app usa solo HTTPS/WSS. Dichiaralo nel form Data Safety.
- Ogni nuova release = nuovo tag `vX.Y.Z` → CI produce `app.aab` → caricalo in Console.
