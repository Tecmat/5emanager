# 5e Manager — Server in Docker (docker compose)

> ⚠️ **Non modificare i file tracciati** (`docker-compose*.yml`, `Dockerfile`):
> le personalizzazioni vanno in `docker/.env` (non tracciato). Se li modifichi, `git pull` va in conflitto:
> backup (`cp file /tmp/`) + `git checkout -- <path>` + `git pull`.
> Nota: se crei/modifichi `docker/.env` con `sudo` resta di root (permessi 600/root) → per modificarlo usa di nuovo `sudo`
> (es. `sudo sh -c "echo 'DND5E_LAN_IP=192.168.1.36' >> docker/.env"`). In `/opt/5emanager` usa sempre `sudo`.


Il server (web app + WebSocket multiplayer + pannello `/admin` + account con **libreria schede
sincronizzata** e **campagne salvate su disco**) gira in un container. I dati persistono nel
volume `docker/data` (campagne, account, schede degli utenti).

## 1) LAN / HTTP (rete locale, test, VPS senza dominio)

### Dalla root del repo clonato (es. `/opt/5emanager`) — il modo più comodo

C'è un **`docker-compose.yml` anche alla root del repo** (`context: .`, `pull_policy: build`):

```bash
cd /opt/5emanager        # root del clone
docker compose up -d     # builda 5emanager-server:latest dal sorgente locale: niente pull da
                         # registry, niente "docker login", niente --build obbligatorio
```

> Se vedi `pull access denied ... repository does not exist` oppure `lstat .../docker: no such file`,
> stai lanciando compose dalla directory sbagliata o senza build: usa il compose alla **root del clone**
> (`docker compose up -d`) oppure `cd docker && docker compose up -d --build`.

### Dalla cartella `docker/`

Il template **`docker/.env.example`** va copiato in `docker/.env` (che **non** è tracciato: i tuoi
secret restano solo sul server, nessun conflitto ai `git pull`):

```bash
cd docker
cp .env.example .env        # in LAN puoi anche saltarlo: i default vanno bene
docker compose up -d --build
```

(se vuoi modificarlo: `PORT`, `DND5E_ADMIN_TOKEN`)

- Web app: `http://<ip-server>:3001`
- Multiplayer (dalle app): `ws://<ip-server>:3001` — le app lo trovano da sole con "🔍 Scansiona rete"
- Pannello admin: `http://<ip-server>:3001/admin` — **non pubblico**: con `DND5E_REQUIRE_AUTH=true` serve
  il login come account admin (senza sessione → redirect a `/login`, account non-admin → 403)
- Dati persistenti: `docker/data/`

## 2) HTTPS su Internet — con il TUO reverse proxy (scegli tu quale)

Il progetto **non include più nginx**: il server gira solo sulla porta `3001` e sta a te esporlo
su Internet con il reverse proxy e il servizio HTTPS che preferisci (Caddy, Traefik, nginx, HAProxy,
Cloudflare Tunnel, ecc.). Requisiti minimi del proxy:

- **TLS** con certificato valido (es. Let's Encrypt) e redirect da http a https
- **WebSocket upgrade**: passare gli header `Upgrade`/`Connection` (la web app passa a `wss://` in automatico)
- passare `Host` e `X-Forwarded-Proto: https`
- timeout di lettura alto (le sessioni WS del multiplayer restano aperte a lungo)

Sicurezza già attiva lato server (non serve configurare nulla, ma il proxy deve passare gli header sopra):
- cookie di sessione `HttpOnly; SameSite=Lax` + **`Secure`** e header **HSTS** automatici quando il server
  vede `X-Forwarded-Proto: https`; header di sicurezza (`nosniff`, anti-clickjacking, CSP, `Referrer-Policy`)
  su tutte le risposte;
- controllo **Origin** sugli upgrade WebSocket: se il proxy non passa `Host` intatto, imposta anche
  `DND5E_RP_ORIGIN` (vedi sotto) altrimenti il browser viene rifiutato con 403;
- primo avvio con zero account: `/` redirecta a `/setup` (creazione primo admin, protetta dal token admin
  generato da Docker); login pagina `/login` per gli altri; una volta loggati la webapp non chiede più
  user/password (sessione cookie) e su Home non mostra "Connetti online" se sei già dentro una campagna;
- `/admin` non è mai pubblica: con `DND5E_REQUIRE_AUTH=true` senza sessione → redirect a `/login`,
  account non-admin → 403, solo account admin vedono il pannello (stesso gate su `adminAuth` WS e su
  `POST /api/update/apply`);
- password degli account con **scrypt + sale** (i vecchi hash sha256 vengono aggiornati al login);
  rate limit sui tentativi di login (default 10 falliti/minuto per username+IP, `DND5E_LOGIN_MAX_ATTEMPTS`).

Esempio con **Caddy** (HTTPS automatico con Let's Encrypt, Caddyfile di 3 righe), server su `127.0.0.1:3001`:

```bash
sudo apt install -y caddy   # oppure il proxy che preferisci
sudo sh -c 'printf "dnd.tuosito.it {\n  reverse_proxy 127.0.0.1:3001\n}\n" > /etc/caddy/Caddyfile'
sudo systemctl enable --now caddy
```

Per le **passkey WebAuthn** (login senza password) servono HTTPS + queste env sul container
(se il proxy non passa `Host` intatto; altrimenti il server le deriva da solo). `DND5E_RP_ORIGIN`
serve anche al controllo Origin dei WebSocket:

```bash
# in docker/.env (o .env della root del clone)
DND5E_RP_ID=dnd.tuosito.it
DND5E_RP_ORIGIN=https://dnd.tuosito.it
```

### Accesso anche dalla LAN (oltre a https dal tuo proxy)

Se vuoi che le app in LAN trovino il server con la scansione rete (`ws://192.168.1.36:3001`) mentre
da remoto si passa dal tuo proxy su 443, avvia con l'override LAN (bind solo sull'IP LAN: la 3001
resta chiusa verso Internet):

```bash
# in docker/.env: DND5E_LAN_IP=192.168.1.36
cd docker
docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d --build
docker ps   # 5emanager-server mostra 192.168.1.36:3001:3001
```

## 3) Deploy remoto passo-passo (VPS + dominio + tuo reverse proxy)

Prerequisiti: dominio con **record A** → IP pubblico del server, porte **80/443 aperte** nel firewall
(es. `ufw allow 80/tcp && ufw allow 443/tcp`), Docker + compose installati, repo clonato in `/opt/5emanager`.

```bash
# 1) server in HTTP/LAN (build sempre dal sorgente locale)
cd /opt/5emanager
docker compose up -d        # dalla root del clone; oppure: cd docker && cp .env.example .env && docker compose up -d --build

# 2) token admin e (per le passkey) RP ID/origin — in .env (root o docker/.env):
#    DND5E_ADMIN_TOKEN=<token-lungo-casuale>
#    DND5E_RP_ID=dnd.tuosito.it
#    DND5E_RP_ORIGIN=https://dnd.tuosito.it

# 3) il TUO reverse proxy con HTTPS (esempio Caddy, cert automatico)
sudo apt install -y caddy
sudo sh -c 'printf "dnd.tuosito.it {\n  reverse_proxy 127.0.0.1:3001\n}\n" > /etc/caddy/Caddyfile'
sudo systemctl enable --now caddy

# 4) verifica automatica
./deploy/smoke-test.sh https://dnd.tuosito.it
# (controlla: index, /version.json, /api/info, /admin, handshake WebSocket 101, redirect http->https)
```

- Web app: `https://dnd.tuosito.it` · Admin: `https://dnd.tuosito.it/admin` · Multiplayer: `wss://dnd.tuosito.it`
  (la web app deriva `wss://` in automatico dall'origin https; nelle app native inserisci `wss://dnd.tuosito.it`).
- **Passkey**: su HTTPS con `DND5E_RP_ID`/`DND5E_RP_ORIGIN` (o `Host` passato dal proxy).
- **Primo admin**: con zero account apri `/setup` e crea il primo admin; poi pannello `/admin` col token.
  In alternativa imposta `DND5E_ADMIN_USER` prima del primo avvio.
- **Aggiornamenti**: `/admin` → "⬇️ Aggiorna la webapp del server ora" (scarica `web-dist.zip` dalla
  release GitHub con backup/rollback). Per il container: `git pull && docker compose up -d --build`.
- **Backup dati**: `tar czf backup-data.tgz -C docker data` (campagne, account incl. TOTP/passkey, librerie).
- **Sicurezza**: tieni `DND5E_ADMIN_TOKEN` segreto, **non esporre mai la 3001 su Internet senza TLS**,
  limita `/admin` se vuoi (allowlist IP nel tuo proxy), proteggi `docker/data` (hash password, secret TOTP, chiavi pubbliche passkey).

## Variabili d'ambiente utili (container `5emanager`)

| Variabile | Default | Significato |
|---|---|---|
| `PORT` / `HOST` | `3001` / `0.0.0.0` | porta e bind del server |
| `DND5E_DATA_DIR` | `/data` | dove salva campagne, account e schede (volume persistente) |
| `DND5E_STATIC_DIR` | `/app/apps/web/dist` | web app servita (buildata dentro l'immagine) |
| `DND5E_ADMIN_TOKEN` | *(vuoto)* | token per `/admin`, `/api/setup` e `POST /api/update/apply`. Se mancante, l'entrypoint Docker ne genera uno (log + `/data/admin-token.txt`) — **impostalo o prendilo dai log in produzione** |
| `GITHUB_TOKEN` | *(vuoto)* | solo se il repo GitHub fosse privato: sblocca check-update e self-update |
| `DND5E_RP_ID` / `DND5E_RP_ORIGIN` | derivati da `Host` | passkey WebAuthn: dominio e origin https — impostali se il tuo reverse proxy non passa `Host` intatto (vedi §2) |
| `DND5E_ADMIN_USER` | *(vuoto)* | username che diventa admin a prescindere dal file (bootstrap primo admin) |
| `DND5E_LAN_IP` / `DND5E_LAN_IPS` | auto (interfacce di rete) | in Docker gli IP rilevati sono quelli del bridge (172.x): impostali con l'IP LAN reale dell'host (es. `DND5E_LAN_IP=192.168.1.36`) così la scansione LAN delle app mostra l'indirizzo giusto |
| `DND5E_REQUIRE_AUTH` | `true` (nei compose) | **webapp di Docker chiusa**: senza account non si accede al sito (si vede solo la pagina di login; `/api/login`, `/api/register`, `/api/info`, `/setup`, `/version.json` restano pubblici). Sui WS `create`/`join`/`action` richiedono la sessione. Le app scaricabili (AppImage/APK/…) restano indipendenti: là il login è facoltativo. Mettilo `false` solo in LAN fidata |
| `DND5E_REGISTRATION` | `approval` | `approval` = registrazione con approvazione dell'admin (richieste in `/admin`); `open` = chiunque si registra subito dalla pagina di login. Cambiabile anche da `/admin` → Impostazioni server |

## Comandi utili

```bash
docker compose logs -f 5emanager        # log del server
docker compose ps                       # stato
docker compose down                     # ferma
docker compose up -d --build            # rebuild dopo un git pull
# backup dei dati (campagne+account+librerie):
tar czf backup-data.tgz -C docker data
```

## Self-update della web app (niente terminale)
Dal pannello admin (`/admin` → "Strumenti admin" → **⬇️ Aggiorna la webapp del server ora**)
il server scarica `web-dist.zip` dall'ultima release GitHub, la scompatta sopra la build corrente
(con backup automatico in `dist.bak` e ripristino in caso di errore). Poi basta ricaricare la pagina.
Se `DND5E_ADMIN_TOKEN` è impostato, il pulsante chiede il token.
