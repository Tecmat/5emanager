# 5e Manager — Server in Docker (docker compose)

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
- Pannello admin: `http://<ip-server>:3001/admin`
- Dati persistenti: `docker/data/`

## 2) HTTPS su Internet con nginx (tu gestisci certificati e reverse proxy)

```bash
cd docker
# cp .env.example .env   # poi modifica solo DND5E_DOMAIN (es. dnd.tuosito.it) e DND5E_ADMIN_TOKEN
mkdir -p certs data certbot-webroot
# certificati (esempio con certbot/acme):
#   certbot certonly --webroot -w docker/certbot-webroot -d dnd.tuosito.it
#   cp /etc/letsencrypt/live/<dominio>/fullchain.pem docker/certs/
#   cp /etc/letsencrypt/live/<dominio>/privkey.pem    docker/certs/
docker compose -f docker-compose.nginx.yml up -d --build
```

- Web app: `https://dnd.tuosito.it` · Admin: `https://dnd.tuosito.it/admin`
- Multiplayer remoto dalle app: `wss://dnd.tuosito.it` (l'upgrade WebSocket passa da nginx in automatico, vedi `docker/nginx/default.conf.template`)

### Se hai già un nginx esterno (cert tuoi sull'host) — usa i file pronti

Non serve il container nginx: vai alla **sezione 2b** qui sotto (`docker-compose.external-nginx.yml` +
`deploy/nginx-external.conf` + `deploy/nginx-upgrade-map.conf`). Snippet minimo equivalente:
Punta il tuo server block al container (porta interna esposta solo sulla rete docker, oppure
pubblica `3001` e fai proxy dal tuo nginx host):

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400s;
}
```

## 2b) HTTPS con il TUO nginx esterno (certificati gestiti da te)

Se hai già nginx sull'host e gestisci i certificati da lì (es. Let's Encrypt con certbot), non serve
il container nginx: usa **`docker/docker-compose.external-nginx.yml`**, che pubblica il server SOLO su
`127.0.0.1:3001` (la porta resta chiusa verso l'esterno; apri solo 80/443 nel firewall).

```bash
# --- sull'HOST (nginx tuo) ---
sudo cp deploy/nginx-upgrade-map.conf /etc/nginx/conf.d/     # map per WebSocket
sudo cp deploy/nginx-external.conf /etc/nginx/sites-available/dnd.conf
sudo sed -i 's/<DOMAIN>/dnd.tuosito.it/g' /etc/nginx/sites-available/dnd.conf
sudo ln -sf /etc/nginx/sites-available/dnd.conf /etc/nginx/sites-enabled/dnd.conf
sudo nginx -t && sudo systemctl reload nginx                  # blocco :80 attivo (challenge ACME)
sudo certbot certonly --webroot -w /var/www/certbot -d dnd.tuosito.it
sudo nginx -t && sudo systemctl reload nginx                  # blocco 443 attivo
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp              # 3001 resta solo su 127.0.0.1

# --- sul server, il container ---
cd /opt/5emanager/docker
cp -n .env.example .env
sed -i 's/^DND5E_DOMAIN=.*/DND5E_DOMAIN=dnd.tuosito.it/' .env
sed -i 's/^DND5E_ADMIN_TOKEN=.*/DND5E_ADMIN_TOKEN=<token-lungo-casuale>/' .env
docker compose -f docker-compose.external-nginx.yml up -d --build

# --- verifica ---
/opt/5emanager/deploy/smoke-test.sh https://dnd.tuosito.it
```

- Web app: `https://dnd.tuosito.it` · Admin: `https://dnd.tuosito.it/admin` · Multiplayer: `wss://dnd.tuosito.it`
  (la web app lo deriva in automatico; nelle app native inserisci `wss://dnd.tuosito.it`).
- Il compose imposta `DND5E_RP_ID`/`DND5E_RP_ORIGIN` dal dominio → **passkey attive** su HTTPS.
- Lo snippet nginx (`deploy/nginx-external.conf`) passa `Upgrade`/`Connection` (WebSocket), `Host` e
  `X-Forwarded-Proto: https`, con `proxy_read_timeout` alto per le sessioni WS lunghe.
- Se preferisci nginx dentro Docker (tutto in un container): resta `docker-compose.nginx.yml` (sezione 2).

## 3) Deploy remoto passo-passo (VPS + dominio + HTTPS con nginx)

Prerequisiti: un dominio con **record A** che punta all'IP pubblico del server, porte **80 e 443 aperte**
(es. `ufw allow 80/tcp && ufw allow 443/tcp`), Docker + compose installati, repo clonato in `/opt/5emanager`.

```bash
# 1) dominio e token
cd /opt/5emanager/docker
cp -n .env.example .env   # -n: non sovrascrivere se esiste già
sed -i 's/^DND5E_DOMAIN=.*/DND5E_DOMAIN=dnd.tuosito.it/' .env
sed -i 's/^DND5E_ADMIN_TOKEN=.*/DND5E_ADMIN_TOKEN=<token-lungo-casuale>/' .env
# opzionale: primo admin bootstrap
# echo 'DND5E_ADMIN_USER=admin' >> .env

# 2) certificato Let's Encrypt (webroot servita dal container nginx)
mkdir -p certs data certbot-webroot
certbot certonly --webroot -w /opt/5emanager/docker/certbot-webroot -d dnd.tuosito.it
cp /etc/letsencrypt/live/dnd.tuosito.it/fullchain.pem certs/fullchain.pem
cp /etc/letsencrypt/live/dnd.tuosito.it/privkey.pem    certs/privkey.pem
chmod 600 certs/privkey.pem

# 3) avvio: server (solo rete docker interna) + nginx esposto su 80/443
docker compose -f docker-compose.nginx.yml up -d --build

# 4) verifica automatica
docker compose -f docker-compose.nginx.yml ps
./../../deploy/smoke-test.sh https://dnd.tuosito.it
# (controlla: index, /version.json, /api/info, /admin, handshake WebSocket 101, redirect http->https)
```

- Web app: `https://dnd.tuosito.it` · Admin: `https://dnd.tuosito.it/admin` (chiede `DND5E_ADMIN_TOKEN`)
- Multiplayer remoto: `wss://dnd.tuosito.it` — la web app lo deriva **in automatico** dall'origin della
  pagina (`wss://` se https, fix v0.1.60); nelle app native (APK/desktop) inserisci `wss://dnd.tuosito.it`
  nel campo server (accetta anche `wss://`).
- **Passkey WebAuthn**: funzionano perché ora c'è HTTPS (secure context). Il compose imposta
  `DND5E_RP_ID`/`DND5E_RP_ORIGIN` dal dominio (nginx passa `Host $host`, quindi anche senza env
  il server li deriva giusti). In Campagna → Account → "Aggiungi passkey".
- **Primo admin**: registra il tuo account dalla web app (richiesta in attesa), poi approv yourself da
  `/admin` (token), oppure imposta `DND5E_ADMIN_USER` prima del primo avvio.
- **Aggiornamenti**: dal pannello `/admin` → "⬇️ Aggiorna la webapp del server ora" (scarica `web-dist.zip`
  dalla release GitHub con backup/rollback). Per il container server: `git pull && docker compose -f
  docker-compose.nginx.yml up -d --build`.
- **Rinnovo certificato** (ogni 90 gg): `certbot renew` poi copia di nuovo i pem in `docker/certs/` e
  `docker compose -f docker-compose.nginx.yml restart nginx`.
- **Backup dati**: `tar czf backup-data.tgz -C /opt/5emanager/docker data` (campagne, account incl. TOTP/passkey, librerie).
- **Sicurezza**: tieni `DND5E_ADMIN_TOKEN` segreto, limita `/admin` se vuoi (es. allowlist IP in nginx),
  proteggi `docker/data` (contiene hash password, secret TOTP e chiavi pubbliche delle passkey).

## Variabili d'ambiente utili (container `5emanager`)

| Variabile | Default | Significato |
|---|---|---|
| `PORT` / `HOST` | `3001` / `0.0.0.0` | porta e bind del server |
| `DND5E_DATA_DIR` | `/data` | dove salva campagne, account e schede (volume persistente) |
| `DND5E_STATIC_DIR` | `/app/apps/web/dist` | web app servita (buildata dentro l'immagine) |
| `DND5E_ADMIN_TOKEN` | *(vuoto)* | token per `/admin`, `/api/setup` e `POST /api/update/apply`. Se mancante, l'entrypoint Docker ne genera uno (log + `/data/admin-token.txt`) — **impostalo o prendilo dai log in produzione** |
| `GITHUB_TOKEN` | *(vuoto)* | solo se il repo GitHub fosse privato: sblocca check-update e self-update |
| `DND5E_RP_ID` / `DND5E_RP_ORIGIN` | derivati da `Host` | passkey WebAuthn: dominio e origin https (impostati in automatico dal compose nginx dal `DND5E_DOMAIN`) |
| `DND5E_ADMIN_USER` | *(vuoto)* | username che diventa admin a prescindere dal file (bootstrap primo admin) |
| `DND5E_LAN_IP` / `DND5E_LAN_IPS` | auto (interfacce di rete) | in Docker gli IP rilevati sono quelli del bridge (172.x): impostali con l'IP LAN reale dell'host (es. `DND5E_LAN_IP=192.168.1.36`) così la scansione LAN delle app mostra l'indirizzo giusto |

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
