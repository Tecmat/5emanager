# Campagne P2P (senza server)

Oltre al server remoto (`npm run server`, WS su porta 3001), l'app può **hostare la campagna
direttamente su un dispositivo** (PC con l'AppImage, o smartphone con hotspot) via **WebRTC**:
niente server, niente dominio, niente porte da aprire.

## Come si usa

### 🔍 Modo automatico (consigliato, stessa rete) — un solo tasto, niente IP da scrivere

1. L'**host** apre la tab 🌐 Campagna → **📡 P2P** → "Faccio da host", mette nome campagna,
   password e nome, spunta **📡 Annunciati su un server LAN** e preme **Avvia host P2P**.
2. Ogni **giocatore** (stessa rete) apre 📡 P2P → "Mi unisco a un host", mette nome e password
   e preme **🔍 Scansiona rete e cerca host**: l'app trova da sola il proprio IP LAN (via ICE
   WebRTC), scansiona la sottorete /24 sondando `/api/info` sui server 5emanager, mostra i
   **server trovati (nome host + IP)** e poi la **lista degli host con nome e IP LAN** —
   un tap su ▶ e si entra. La lista si aggiorna da sola ogni 8 s.
3. In modalità relay (senza WebRTC, es. AppImage) il **master vede le richieste in attesa**
   e le accetta/rifiuta con **✅ Accetta / ✖ Rifiuta** — nessun codice da incollare.
   Con WebRTC (browser) resta il codice invito/QR come via senza server.

### ✍️ Modo manuale (senza alcun server, solo WhatsApp/QR)

1. L'host avvia l'host P2P e, dal pannello online, preme **➕ Nuovo codice invito**: il codice
   appare come **testo + QR**, con i bottoni **📋 Copia** e **📤 Condividi** (usa la condivisione
   nativa dello smartphone).
2. Il giocatore apre 📡 P2P → "Mi unisco a un host" → **✍️ incolla il codice** (o lo **📷 scansiona
   dal QR**) → **1️⃣ Genera risposta** → copia/condivide la **risposta**.
3. L'host incolla la risposta in **Incolla qui la risposta del giocatore** → **✅ Collega giocatore**.

### 🔑 Codice invito breve — SERVERLESS (funziona solo P2P, quando la scansione con un clic fallisce)

L'host genera un **codice breve `XXXX-XXXX`** (mostrato grande + **QR `5ECODE:…`**, scansionabile
anche dalla fotocamera di sistema del telefono). **Non serve alcun server**:

1. L'host LAN (beacon porta 3177) **pubblica il codice nel proprio `/api/info`** (`LanBeaconPlugin` /
   `lan_beacon_start`/`lan_beacon_set_code`); è visibile nella card host appena avvii "Ospita su questa rete".
2. Il giocatore digita il codice (o scansiona il QR `5ECODE:…`) → **Unisciti**: l'app **scansiona la
   LAN** (come "🔍 Scansiona rete", sondeggia `/api/info` sulla /24) e trova l'host con quel codice →
   si collega diretto a `ws://<ip>:3177/ws`. Funziona finché i due dispositivi sono sulla stessa
   WiFi/hotspot — nessuna dipendenza da server.
3. **Alternativa solo per reti diverse** (es. telefono in 4G, PC a casa): se entrambi possono
   raggiungere un server 5emanager, l'host preme **📡 Annuncia su server LAN** e il codice viene
   registrato lì (`p2pAnnounceCode`/`p2pJoinCode`/`p2pCodeHost`, TTL 90 s, ri-annunciato ogni 30 s,
   normalizzato maiuscole/senza trattini): il server fa solo da centralino e relay SDP.
   Senza server e su reti diverse resta il codice SDP completo `5EP2P1:…` (sezione sopra).

## Fallback senza WebRTC (AppImage/WebKitGTK, browser datati)

Su alcuni ambienti `RTCPeerConnection` **non esiste** (tipicamente la WebKitGTK dell'AppImage
su Linux). In quel caso il P2P passa automaticamente sul **trasporto relay**: la campagna resta
sull'host, ma il traffico di gioco viaggia incapsulato (`p2pData`) sul WebSocket del server LAN,
che fa solo da relay opaco. Stesso flusso "cerca host → un click", niente codici da copiare.
- Lato client: `P2PRelayHost`/`P2PRelayClient` in `apps/web/src/p2p.ts` (selezionati
  automaticamente quando `webrtcSupported()` è falso).
- Lato server: relay `p2pJoin` (con name/password) e `p2pData` in `packages/server/src/index.ts`.
- Nota Bluetooth: `navigator.bluetooth` (Web Bluetooth) esiste solo su Chrome/Android WebView,
  non su WebKitGTK, e il Bluetooth classico non è esposto alle web app: non coprirebbe il caso
  AppImage. Il relay WebSocket copre invece tutte le piattaforme.

## Dettagli tecnici

- `apps/web/src/p2p.ts`: `P2PHost`/`P2PClient` su `RTCPeerConnection` + DataChannel.
  Signaling via codice base64 (`5EP2P1:…`): **offer dell'host → answer del giocatore**
  (il codice invito è l'offer; la risposta del giocatore è l'answer).
- QR generato in-app senza dipendenze (`apps/web/src/qr.ts`, `qrEncode`/`qrSvg`); scansione
  con `BarcodeDetector` quando il browser la supporta (Chrome Android), altrimenti incolla.
- Discovery: `P2PDiscovery` si collega a un server 5emanager (`p2pAnnounce`/`p2pList`/
  `p2pJoin`/`p2pOffer`/`p2pAnswer`/`p2pData` in `packages/server`): gli host si annunciano
  (TTL 90 s, ri-annuncio ogni 30 s) con **nome e IP LAN** (dal socket), e i giocatori li
  vedono e si uniscono con un click.
- Scansione LAN automatica: `apps/web/src/lan.ts` (`scanLan`) + `packages/core/src/net.ts`
  (`hostsInSubnet`, `localIpViaWebRTC`); il server espone `GET /api/info`
  (`{app:'5emanager', name, version, lan}`) per essere riconosciuto durante la scansione.
- I messaggi sono gli stessi del server WS (`join`/`welcome`/`state`/`action`/`error`/`pong`/`campaignDeleted`),
  e la logica di campagna è la stessa: `applyCampaignAction` in `packages/core/src/campaign.ts`
  (pura, usata sia dal server Node sia dall'host nel browser).
- La campagna P2P vive solo in memoria dell'host: se l'host chiude l'app, la campagna finisce
  (i giocatori ricevono `campaignDeleted`). Le schede restano salvate localmente su ogni dispositivo.
- La password della campagna P2P è confrontata in memoria dall'host (campagna effimera).

## Host LAN "stile Soul Knight" (v0.1.27+) — niente server, niente codici

Su **AppImage/desktop e APK Android** il dispositivo host può aprire un **beacon LAN** nativo
(mini server HTTP+WS su `0.0.0.0:3177`):

- **Host**: tab 🌐 Campagna → P2P → "Faccio da host" → pulsante **🖥️ Ospita su questa rete (LAN)**.
  L'app risponde a `GET /api/info` con `{app:"5emanager", kind:"p2p-host", name, version, port}`
  e accetta WebSocket su `/ws`. L'host vede le richieste in arrivo con **✅ Accetta / ✖ Rifiuta**.
- **Giocatori** (stessa WiFi/hotspot): un solo tasto **🔍 Scansiona rete e cerca host** → la scansione
  della /24 trova gli host P2P e li mostra come `▶ nome (IP LAN)` → **un tap** apre il WebSocket
  diretto `ws://ip:3177/ws` e si entra (dopo l'accettazione del master).
- Dal **browser** il beacon non è possibile (il browser non può aprire porte): si usa il server
  remoto oppure il codice invito WebRTC come prima.
- Trasporto: WebSocket diretto host↔client, quindi funziona anche dove WebRTC manca (WebKitGTK).

Implementazione nativa: comando Tauri `lan_beacon_*` (axum, `src-tauri/src/lib.rs`) e plugin
Android `LanBeaconPlugin` (NanoHTTPD-WS, `apps/web/android-overlay/`, patchato in CI da `patch_android.py`).
