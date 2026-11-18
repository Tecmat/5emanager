# Campagne P2P (senza server)

Oltre al server remoto (`npm run server`, WS su porta 3001), l'app può **hostare la campagna
direttamente su un dispositivo** (PC con l'AppImage, o smartphone con hotspot) via **WebRTC**:
niente server, niente dominio, niente porte da aprire.

## Come si usa

1. L'**host** apre la tab 🌐 Campagna → toggle **📡 P2P** → "Faccio da host": mette nome campagna,
   password e il suo nome, poi **Avvia host P2P**.
2. Ogni **giocatore** (stessa rete WiFi/LAN/hotspot dell'host) apre la stessa tab → 📡 P2P →
   "Mi unisco a un host" → mette nome e password → **1️⃣ Genera codice invito**, copia il codice
   e lo manda all'host (WhatsApp/Telegram/…), poi incolla la **risposta dell'host** → **Connetti**.
3. L'host, dal pannello online, incolla il codice del giocatore in **📨 Aggiungi giocatori**,
   genera la risposta e la manda al giocatore.

## Dettagli tecnici

- `apps/web/src/p2p.ts`: `P2PHost`/`P2PClient` su `RTCPeerConnection` + DataChannel.
  Signaling manuale via codice base64 (`5EP2P1:…`): offer del joiner → answer dell'host.
- I messaggi sono gli stessi del server WS (`join`/`welcome`/`state`/`action`/`error`/`pong`/`campaignDeleted`),
  e la logica di campagna è la stessa: `applyCampaignAction` in `packages/core/src/campaign.ts`
  (pura, usata sia dal server Node sia dall'host nel browser).
- La campagna P2P vive solo in memoria dell'host: se l'host chiude l'app, la campagna finisce
  (i giocatori ricevono `campaignDeleted`). Le schede restano salvate localmente su ogni dispositivo.
- La password della campagna P2P è confrontata in memoria dall'host (campagna effimera).
