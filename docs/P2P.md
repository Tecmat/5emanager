# Campagne P2P (senza server)

Oltre al server remoto (`npm run server`, WS su porta 3001), l'app può **hostare la campagna
direttamente su un dispositivo** (PC con l'AppImage, o smartphone con hotspot) via **WebRTC**:
niente server, niente dominio, niente porte da aprire.

## Come si usa

### 🔍 Modo automatico (consigliato, stessa rete) — un solo tasto

1. L'**host** apre la tab 🌐 Campagna → **📡 P2P** → "Faccio da host", mette nome campagna,
   password e nome, spunta **📡 Annunciati su un server LAN** e preme **Avvia host P2P**.
   Il server LAN viene individuato da solo (origin della pagina se la web app è servita dal
   server, oppure l'ultimo `ws://…` salvato); in alternativa si può indicare a mano.
2. Ogni **giocatore** (stessa rete) apre 📡 P2P → "Mi unisco a un host", mette nome e password
   e preme un solo tasto **🔍 Cerca host sulla rete**: la lista si aggiorna da sola ogni 8 s,
   vede l'host e preme **▶** — la connessione si apre da sola (il server fa solo da relay
   dei codici di segnalazione, il traffico di gioco resta P2P diretto tra i dispositivi).
   - Su **Android/AppImage** il server LAN è l'ultimo `ws://…` impostato (campo "Server
     WebSocket" in alto); se è `localhost` va sostituito con l'IP del server (es.
     `ws://192.168.1.10:3001`).

### ✍️ Modo manuale (senza alcun server, solo WhatsApp/QR)

1. L'host avvia l'host P2P e, dal pannello online, preme **➕ Nuovo codice invito**: il codice
   appare come **testo + QR**, con i bottoni **📋 Copia** e **📤 Condividi** (usa la condivisione
   nativa dello smartphone).
2. Il giocatore apre 📡 P2P → "Mi unisco a un host" → **✍️ incolla il codice** (o lo **📷 scansiona
   dal QR**) → **1️⃣ Genera risposta** → copia/condivide la **risposta**.
3. L'host incolla la risposta in **Incolla qui la risposta del giocatore** → **✅ Collega giocatore**.

## Dettagli tecnici

- `apps/web/src/p2p.ts`: `P2PHost`/`P2PClient` su `RTCPeerConnection` + DataChannel.
  Signaling via codice base64 (`5EP2P1:…`): **offer dell'host → answer del giocatore**
  (il codice invito è l'offer; la risposta del giocatore è l'answer).
- QR generato in-app senza dipendenze (`apps/web/src/qr.ts`, `qrEncode`/`qrSvg`); scansione
  con `BarcodeDetector` quando il browser la supporta (Chrome Android), altrimenti incolla.
- Discovery: `P2PDiscovery` si collega a un server 5emanager (`p2pAnnounce`/`p2pList`/
  `p2pJoin`/`p2pOffer`/`p2pAnswer` in `packages/server`): gli host si annunciano (TTL 90 s,
  ri-annuncio ogni 30 s) e i giocatori li vedono e si uniscono con un click.
- I messaggi sono gli stessi del server WS (`join`/`welcome`/`state`/`action`/`error`/`pong`/`campaignDeleted`),
  e la logica di campagna è la stessa: `applyCampaignAction` in `packages/core/src/campaign.ts`
  (pura, usata sia dal server Node sia dall'host nel browser).
- La campagna P2P vive solo in memoria dell'host: se l'host chiude l'app, la campagna finisce
  (i giocatori ricevono `campaignDeleted`). Le schede restano salvate localmente su ogni dispositivo.
- La password della campagna P2P è confrontata in memoria dall'host (campagna effimera).
