# Deploy su server Debian (systemd + nginx opzionale)

## 1. Prerequisiti

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
# Node.js 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v22.x
```

## 2. Utente di servizio e codice

```bash
sudo useradd -r -m -s /usr/sbin/nologin 5eapp
sudo mkdir -p /opt/5emanager /var/lib/5emanager/data
sudo chown -R 5eapp:5eapp /opt/5emanager /var/lib/5emanager
sudo -u 5eapp git clone git@github.com:Tecmat/5emanager.git /opt/5emanager/app
```

### Accesso SSH (deploy key, consigliato per repo privato)

```bash
sudo -u 5eapp ssh-keygen -t ed25519 -C "5eapp@debian-server" -f /home/5eapp/.ssh/id_ed25519 -N ""
sudo chmod 700 /home/5eapp/.ssh && sudo chmod 600 /home/5eapp/.ssh/id_ed25519*
sudo -u 5eapp cat /home/5eapp/.ssh/id_ed25519.pub
# copia la chiave pubblica → GitHub → repo 5emanager → Settings → Deploy keys → Add deploy key (Read-only basta per il pull)
sudo -u 5eapp ssh -T git@github.com          # verifica: "Hi Tecmat! You've successfully authenticated"
cd /opt/5emanager/app && sudo -u 5eapp git remote set-url origin git@github.com:Tecmat/5emanager.git
```

In alternativa, per test veloci: `https://<TOKEN>@github.com/Tecmat/5emanager.git` (mai committare il token).

```bash
cd /opt/5emanager/app
sudo -u 5eapp git checkout vibe/dnd5e-scheda-f0caaa
sudo -u 5eapp npm ci --omit=dev --include=dev   # tsx serve per run; in alternativa compila
sudo -u 5eapp npm run build -w @dnd5e/web
```

## 3. Servizio systemd

Il file unit è nel repo: `deploy/5emanager.service`. Copialo e avvia:

```bash
sudo cp /opt/5emanager/app/deploy/5emanager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 5emanager
sudo systemctl status 5emanager
journalctl -u 5emanager -f     # log; all'avvio vedi gli IP LAN
```

Test: `http://<ip-server>:3001/` (la web app) e `ws://<ip-server>:3001`.

## 4. (Opzionale) Dominio + HTTPS con nginx + certbot

Solo se vuoi esporlo fuori dalla LAN — **mai esporre la porta 3001 direttamente su Internet senza TLS**.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/5emanager`:

```nginx
server {
    listen 80;
    server_name dnd.tuo-dominio.it;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/5emanager /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dnd.tuo-dominio.it
```

Poi i giocatori usano `https://dnd.tuo-dominio.it/` e nell'app `wss://dnd.tuo-dominio.it`.

## 5. Aggiornare il codice

```bash
cd /opt/5emanager/app
sudo -u 5eapp git pull
sudo -u 5eapp npm ci
sudo -u 5eapp npm run build -w @dnd5e/web
sudo systemctl restart 5emanager
```

## 6. Backup

Le campagne sono JSON in `/var/lib/5emanager/data` (`DND5E_DATA_DIR`): backup con
`tar czf /var/backups/5emanager-data-$(date +%F).tgz /var/lib/5emanager/data` (es. via cron).
