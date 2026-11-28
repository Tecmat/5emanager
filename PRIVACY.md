# Privacy Policy — 5e Manager

**Last updated:** 2026-11-25 · **App:** 5e Manager (`com.tecmat.emanager`) · **Developer:** Tecmat
**Contact:** privacy@tecmat.it — [Security policy](SECURITY.md)

URL pubblica per il Play Console: `https://github.com/Tecmat/5emanager/blob/main/PRIVACY.md`

## In sintesi
5e Manager **non raccoglie, non vende e non condivide dati personali con server di terzi**. Non ci sono
analytics, tracker, pubblicità né SDK di terze parti per la raccolta dati. I tuoi dati restano **sul tuo
dispositivo** (IndexedDB) o sul **tuo server self-hosted**, che controlli tu.

## Dati tratados dall'app
- **Schede personaggio, campagne, impostazioni**: salvati **solo in locale** sul dispositivo (IndexedDB)
  e, se fai login su un tuo server 5e Manager, **sulla libreria del tuo server** (sincronizzazione scelta da te).
  Non inviamo questi dati a nessun altro server.
- **Connessione di rete**: l'app parla solo con (a) il tuo server 5e Manager (self-hosted, via `wss://` su
  HTTPS o `ws://` in LAN) e (b) in LAN con altri dispositivi per il multiplayer P2P. Su Android, per trovare
  server/host in LAN, l'app interroga la rete locale (broadcast UDP/HTTP su porte dedicate) e invia il nome
  del dispositivo solo ai peer della stessa rete.
- **Fotocamera (`CAMERA`)**: usata **solo quando scansioni un QR** (codice invito campagna / server), mai in
  background; l'immagine è processata solo in locale per leggere il codice.
- **Aggiornamenti (Android)**: l'app **non si auto-aggiorna in-app** (il permesso
  `REQUEST_INSTALL_PACKAGES` è stato rimosso). Sulla versione Google Play gli aggiornamenti arrivano
  solo dallo Store; le build sideload (APK dalle release GitHub) si aggiornano scaricando la nuova
  APK dalla pagina ufficiale delle release (`github.com/Tecmat/5emanager/releases`) e installandola
  a mano.
- **Passkey (WebAuthn)**: le chiavi private restano **nel tuo dispositivo/gestore password** e sul server
  resta solo la chiave pubblica; il login usa challenge firmati, mai la chiave privata.
- **Promemoria sessione (notifiche locali)**: le notifiche sono generate dal dispositivo, senza rete.

## Sicurezza
- Comunicazioni col tuo server in chiaro solo in LAN (`http://`/`ws://` su IP privati); su Internet si usa
  sempre HTTPS/WSS.
- Le password degli account del server sono salvate con **scrypt + sale**; le sessioni sono cookie
  `HttpOnly; SameSite=Lax` (+`Secure` su HTTPS).
- Vedi [SECURITY.md](SECURITY.md) per segnalare vulnerabilità.

## Modifiche
Aggiorneremo questa policy se cambiano le pratiche; la data in cima indica l'ultima versione.

---

# Privacy Policy — 5e Manager (English summary)
5e Manager does **not** collect, sell or share personal data with third-party servers. No analytics, no ads,
no tracking SDKs. Your data stays **on your device** (IndexedDB) or on **your own self-hosted server**.
Camera is used only when you scan a QR code. The Android app does not self-update in-app (the `REQUEST_INSTALL_PACKAGES` permission was removed): on Google Play updates come only from the Play Store, and sideloaded builds update by downloading the new APK from the official GitHub releases. Passkey private keys never leave your device.
Contact: privacy@tecmat.it
