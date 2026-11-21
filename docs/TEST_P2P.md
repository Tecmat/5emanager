# Test P2P LAN desktop ↔ Android (AppImage ↔ APK)

Obiettivo: master e giocatori su **combinazioni miste** (PC + telefoni sulla stessa WiFi/hotspot),
senza server e senza codici: scansione + un tap. Il trasporto è WebSocket diretto sul beacon
(porta 3177) — funziona anche su AppImage (WebKitGTK, niente WebRTC).

## Matrice di test

| # | Host (master) | Giocatori | Passi attesi |
|---|---|---|---|
| 1 | AppImage su PC | APK su telefono, stessa WiFi | PC: Campagna → P2P → "Ospita su questa rete (LAN)" → mostra `ws://<ip-pc>:3177`. Telefono: P2P → "Mi unisco" → "Scansiona rete e cerca host" → appare `▶ nome (ip-pc)` → tap → master vede richiesta → ✅ Accetta → dentro. |
| 2 | APK su telefono (hotspot) | AppImage su PC dentro l'hotspot | Telefono: host LAN. PC: scansione → host trovato → tap → accetta → dentro. |
| 3 | APK | APK (stessa rete) | Come #1 fra due telefoni. |
| 4 | AppImage | AppImage | Come #1 fra due PC. |
| 5 | Browser (web) | qualsiasi | Il browser non può aprire il beacon: usa server remoto o codice invito. |

## Cosa verificare in ogni test

- [ ] La scansione trova l'host entro pochi secondi e mostra **nome + IP** (`▶ nome (192.168.x.x)`)
- [ ] Un tap sull'host → richiesta di join → sul master appare la riga con **Accetta / Rifiuta**
- [ ] Dopo l'accettazione: il giocatore vede la campagna (welcome) e la lista giocatori si aggiorna su entrambi
- [ ] Azioni dal telefono (tira dado, usa incantesimo, equipaggia) si vedono sul PC in tempo reale (state broadcast)
- [ ] La scheda usata in campagna è la **copia "campagna:<id>"**: la scheda locale resta intatta (selettore in alto: Locale / 🗺 Campagna)
- [ ] Disconnessione di un giocatore → sparisce dalla lista sul master
- [ ] Se la scansione non trova nulla: controlla che i dispositivi siano sulla **stessa sottorete** (stessa WiFi o hotspot del telefono host) e che il firewall non blocchi la porta 3177

## Note tecniche

- Su AppImage la scansione usa l'**IP nativo** (`lan_local_ip`, trucco UdpSocket in Rust) perché WebKitGTK non ha WebRTC — la scansione funziona lo stesso
- Su APK l'IP arriva dal plugin `LanBeacon.localIp()` (interfacce di rete)
- Il beacon risponde a `GET http://<ip>:3177/api/info` con `{app:"5emanager",kind:"p2p-host",name,version,port}`
- Il traffico di gioco è WS su `ws://<ip>:3177/ws` (niente relay, niente server)
- Su Android l'APK deve avere i permessi INTERNET (nel manifest via patch CI)

## Se PC e telefono "non si vedono" (checklist rapida, es. AppImage su CachyOS + APK)

1. **Stessa rete e stessa sottorete**: telefono e PC devono avere IP tipo `192.168.1.x` entrambi.
   Attenzione: sulle reti WiFi "guest" o con **isolamento client (AP isolation)** attivo sul router,
   i dispositivi non si parlano anche se sono sulla stessa WiFi -> usa la WiFi principale o l'hotspot del telefono.
2. **Firewall**: la porta **3177** deve essere raggiungibile dagli altri dispositivi.
   - Windows: Impostazioni -> Firewall -> consenti un'app -> aggiungi 5e.Manager (o la porta 3177)
   - Linux/CachyOS: di solito nessun firewall attivo; se usi ufw: `sudo ufw allow 3177/tcp`
3. L'host ha premuto **"Ospita su questa rete (LAN)"** e vede `ws://<suo-ip>:3177` nella sua scheda.
4. Sul telefono: **"Scansiona rete e cerca host"** -> l'host appare con nome + IP -> tap -> il master vede la richiesta -> **Accetta**.
5. Verifica rapida dal PC: apri nel browser `http://<ip-pc>:3177/api/info` -> deve rispondere JSON con `"kind":"p2p-host"`.
