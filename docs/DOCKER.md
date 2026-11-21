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

C'è già un **`docker/.env` precompilato** committato: basta

```bash
cd docker
docker compose up -d --build
```

(se vuoi modificarlo: `PORT`, `DND5E_ADMIN_TOKEN`; il file `.env.example` resta come riferimento)

- Web app: `http://<ip-server>:3001`
- Multiplayer (dalle app): `ws://<ip-server>:3001` — le app lo trovano da sole con "🔍 Scansiona rete"
- Pannello admin: `http://<ip-server>:3001/admin`
- Dati persistenti: `docker/data/`

## 2) HTTPS su Internet con nginx (tu gestisci certificati e reverse proxy)

```bash
cd docker
# .env è già precompilato: modifica solo DND5E_DOMAIN (es. dnd.tuosito.it) e DND5E_ADMIN_TOKEN
mkdir -p certs data certbot-webroot
# certificati (esempio con certbot/acme):
#   certbot certonly --webroot -w docker/certbot-webroot -d dnd.tuosito.it
#   cp /etc/letsencrypt/live/<dominio>/fullchain.pem docker/certs/
#   cp /etc/letsencrypt/live/<dominio>/privkey.pem    docker/certs/
docker compose -f docker-compose.nginx.yml up -d --build
```

- Web app: `https://dnd.tuosito.it` · Admin: `https://dnd.tuosito.it/admin`
- Multiplayer remoto dalle app: `wss://dnd.tuosito.it` (l'upgrade WebSocket passa da nginx in automatico, vedi `docker/nginx/default.conf.template`)

### Se hai già un nginx esterno
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

## Variabili d'ambiente utili (container `5emanager`)

| Variabile | Default | Significato |
|---|---|---|
| `PORT` / `HOST` | `3001` / `0.0.0.0` | porta e bind del server |
| `DND5E_DATA_DIR` | `/data` | dove salva campagne, account e schede (volume persistente) |
| `DND5E_STATIC_DIR` | `/app/apps/web/dist` | web app servita (buildata dentro l'immagine) |
| `DND5E_ADMIN_TOKEN` | *(vuoto)* | token richiesto dal pannello `/admin` e da `POST /api/update/apply` — **impostalo in produzione** |
| `GITHUB_TOKEN` | *(vuoto)* | solo se il repo GitHub fosse privato: sblocca check-update e self-update |

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
