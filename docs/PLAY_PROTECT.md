# Play Protect e distribuzione dell'APK

## Perché Play Protect segnala l'APK

1. **Firma debug**: gli APK `assembleDebug` sono firmati con la chiave debug di Google → Play Protect
   li segnala sempre in sideload. **Soluzione**: APK release-firmati con il tuo keystore (vedi sotto).
2. **Permesso `REQUEST_INSTALL_PACKAGES`** (installa app sconosciute): **rimosso dall'app**. È una
   permission "restricted" di Play e non serve più: niente self-update in-app. Gli aggiornamenti sideload
   si fanno scaricando la nuova APK dalla pagina delle release GitHub e installandola a mano (stessa firma,
   altrimenti Android blocca l'installazione). Anche il FileProvider custom è stato rimosso dal manifest.

3. **Permesso `CAMERA`**: richiesto a runtime solo quando scansioni un QR (niente uso in background).
   Per Play Store serve una **privacy policy** che dichiari l'uso della fotocamera.
4. **`usesCleartextTraffic=true`**: necessario perché l'app (servita da `https://localhost` da Capacitor)
   deve parlare in chiaro con la LAN (server `ws://ip:3001`, beacon P2P `ws://ip:3177`, probe `http://ip:3177/api/info`).
   Play Protect lo considera un avviso, non un blocco, in sideload. Per il Play Store valuta una
   `networkSecurityConfig` che limita il cleartext agli IP privati (LAN).

## Firma release in CI (consigliata)

Crea un keystore una volta sola:

```bash
keytool -genkeypair -keystore keystore.jks -alias 5e -keyalg RSA -keysize 2048 -validity 10000
# poi nel repo GitHub: Settings → Secrets → Actions:
#   ANDROID_KEYSTORE_B64      = base64 del file keystore.jks  (base64 -w0 keystore.jks)
#   ANDROID_KEYSTORE_PASSWORD = store password
#   ANDROID_KEY_ALIAS         = 5e
#   ANDROID_KEY_PASSWORD      = key password
```

Con questi secret la release CI produce `app.apk` **release-signed**; senza secret resta debug (`app.apk` da `assembleDebug`). Stesso asset name `app.apk` in release.

## Per il Play Store (più avanti)

- APK/AAB release-signed con keystore tuo (come sopra, `bundleRelease`)
- privacy policy pubblicata (URL nell'app listing) che dichiari: fotocamera (QR) e rete
- Data Safety form: nessun dato raccolto/transmesso a server tuoi; le schede restano sul dispositivo o sul TUO server
- `targetSdk 36` (requisito Play Store, già così dalla v0.1.92)

## Firma stabile degli APK debug in CI (v0.1.58+)

Il keystore `apps/web/android-overlay/debug.keystore` (PKCS12, alias `androiddebugkey`, password
`android`) \u00e8 **committato nel repo apposta**: \u00e8 una chiave pubblica pensata solo per il sideload
(come la debug key standard di Android), non protegge nulla e non va usata per il Play Store.
`patch_android.py` lo copia nel progetto generato e configura `signingConfigs.debug` su di esso:
cos\u00ec ogni build CI (`assembleDebug`) ha la **stessa firma** e la nuova APK si installa sopra quella vecchia.
Prima di v0.1.58 ogni runner generava una debug key diversa in `~/.android/debug.keystore`,
quindi ogni APK aveva firma diversa e Samsung mostrava "app non installata"
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). **Migrazione**: se l'app installata ha firma diversa,
disinstalla e installa a mano la nuova APK (esporta prima le schede: i dati locali vivent sul
dispositivo e vengono cancellati con la disinstallazione).

## Nota storica (v0.1.57+ → rimosso)

Il plugin nativo `UpdateInstaller` (download + prompt di installazione in-app, con validazione
pre-installazione: magic `PK`, `getPackageArchiveInfo`, no downgrade, firme confrontate) è stato
**rimosso insieme al permesso `REQUEST_INSTALL_PACKAGES`**: sulle build Play il self-update via APK è
vietato. Per aggiornare una build sideload basta scaricare la nuova APK dalla release e installarla a
mano: con la stessa firma l'installazione in-place funziona, altrimenti Android mostra “app non
installata” (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) e serve disinstallare prima (dopo aver esportato le
schede locali).
