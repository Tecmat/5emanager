# Architettura multiplayer (server)

Il progetto resta **local-first**, ma c'è un server opzionale self-hosted che permette a
master e giocatori di incontrarsi in una **campagna** condivisa con combattimento live.

```
packages/server   # Node + ws: HTTP statici (apps/web/dist) + WebSocket, campagne in JSON
packages/core     # riutilizzato lato server: regole, combattimento, action economy
apps/web          # tab "🌐 Campagna": crea/unisciti, lobby, pannello master, combattimento live
```

## Avvio

```bash
npm install
npm run build -w @dnd5e/web   # la web app da servire
npm run server                # http://0.0.0.0:3001  (PORT/HOST/DND5E_DATA_DIR env)
```

Apri `http://<host>:3001/` da più dispositivi (stessa rete) → tab **🌐 Campagna**.

- **Master**: "Crea campagna" → ottiene un ID a 8 caratteri da dare ai giocatori + password.
- **Giocatori**: "Unisciti" → elenco campagne sul server (o ID manuale) + password + nome, poi caricano la propria scheda locale ("Carica la mia scheda").

## Flusso di combattimento (action economy)

1. Master: **Avvia combattimento** → tutti i PG entrano con initiative tirata, CA e attacchi calcolati dalla scheda
2. Master: **Aggiungi nemico** dallo statblock (goblin, orco, lupo, scheletro, bandito, ogre — estendibili in `enemies.json` o custom)
3. A ogni turno il combattente corrente ha: ✅azione / ✅bonus / ✅reazione / 🏃movimento (speed)
4. **Attacco**: scegli il bersaglio e l'arma → il server tira d20+bonus contro la CA (20 = critico, dadi raddoppiati), applica i danni e logga tutto
5. **Condizioni con durata in round** (stordito 2 round...), decrementate automaticamente a inizio turno
6. Master può: rilanciare initiative, infliggere/curare PF, aggiungere condizioni, terminare il combattimento, **espellere un giocatore** (`kickPlayer` — il client riceve `kicked` e viene disconnesso subito)

## Ruoli account e pannello admin

Gli account hanno un **ruolo** (`admin` / `user`): il primo account creato (o quello indicato con
`DND5E_ADMIN_USER`) è admin; un account admin entra nel pannello `/admin` direttamente dal login
in app, senza `DND5E_ADMIN_TOKEN`.

Dal pannello `/admin` l'admin può: approvare/rifiutare registrazioni, **promuovere/declassare** utenti
(`adminSetRole`), **resettare la password** (`adminResetPassword`), eliminare account e schede, vedere i
**giocatori di una campagna e espellerli** (`adminCampaignDetail` / `adminKickPlayer`), creare/modificare/
eliminare campagne, broadcast a tutti i client.

Sync remoto: le **schede della libreria account** si sincronizzano dalla Home (card ☁️: salva tutte /
scarica tutte / per singola scheda); le **campagne P2P salvate in locale** si sincronizzano sull'account
dalla tab 💾 Campagne P2P ("☁️ sync su server") — senza password, quindi scaricabili su un altro dispositivo.

## 2FA TOTP (app authenticator)

Gli account possono attivare la **verifica in due passaggi** (RFC 6238, HMAC-SHA1, 30 s, 6 cifre —
compatibile con Google Authenticator, Aegis, ecc.), implementata in purezza in `packages/server/src/totp.ts`
(zero dipendenze, `node:crypto`; test con i vettori RFC 6238).

- **Attivazione** (dall'app, loggati): `setupTotp` → il server risponde `totpSetup` con `secret`,
  `otpauth://…` (QR) e **8 codici di backup** (mostrati una sola volta; salvati solo come hash sha256).
  L'app mostra il QR e l'utente conferma con `enableTotp` + codice a 6 cifre (finestra ±30 s).
- **Login**: con 2FA attiva, `login` (password) risponde `totpRequired` e NON crea sessione;
  poi `loginTotp` (password + codice) oppure `loginTotpBackup` (password + codice backup, **monouso**).
- **Sicurezza**: throttle anti-bruteforce (max 5 tentativi/minuto per username, in memoria);
  disattivazione solo con password (`disableTotp`). Il secret TOTP è salvato in `accounts.data`
  → proteggi `DND5E_DATA_DIR` (come già per le campagne).
- Play Protect: APK release-signed via secret CI (il runbook di pubblicazione è privato e non versionato)
  `ANDROID_KEYSTORE_B64` (la CI avvisa se manca), e il plugin di self-update valida l'APK prima
  dell'installazione (firma confrontata con l'app installata, no downgrade, magic PK) così un
 安装 fallita su Samsung/One UI (“app non installata”) diventa un messaggio chiaro.

## Passkey WebAuthn (login passwordless)

Oltre alla 2FA TOTP, gli account possono registrare **passkey** (WebAuthn: impronta/PIN del
dispositivo, chiavetta di sicurezza o password manager) con `@simplewebauthn/server` +
`@simplewebauthn/browser` (v13). Implementazione in `packages/server/src/passkeys.ts`.

- **Requisito**: WebAuthn funziona solo in **secure context** — HTTPS (o `localhost`).
  Su LAN in chiaro (`http://192.168.x.x`) il browser blocca la API: configura HTTPS
  (il proprio reverse proxy HTTPS, vedi [docs/DOCKER.md](docs/DOCKER.md)). L'app nasconde i bottoni
  passkey quando `window.isSecureContext` è falso e mostra un avviso.
- **RP ID / origin**: derivati dall'header `Host` della connessione WS (in locale `http://localhost:3001`,
  dietro proxy `https://<dominio>`), con override da env:
  - `DND5E_RP_ID` es. `dnd.example.com` (solo dominio)
  - `DND5E_RP_ORIGIN` es. `https://dnd.example.com` (origin esatto della pagina)
  - `DND5E_RP_NAME` nome mostrato nel prompt (default `5e Manager`)
- **Flusso**: `passkeyRegisterStart`/`passkeyRegisterFinish` (richiede login) registra la
  credenziale sull'account (max 10, salvata in `accounts.data` v6 come id base64url +
  publicKey base64 + counter anti-replay). `passkeyLoginStart`/`passkeyLoginFinish` fa login
  **senza password**: con `username` usa solo le sue passkey, senza username usa una passkey
  *discoverable* (il server risale all'account dalla credenziale). La passkey conta come
  **secondo fattore**: col login passkey la 2FA TOTP non viene richiesta. Throttle
  anti-bruteforce come per la 2FA (5/min). `passkeyList`/`passkeyRemove` gestiscono le chiavi
  dall'app (Campagna → Account).
- **Sicurezza**: le credenziali restano in `accounts.data` → proteggi `DND5E_DATA_DIR`.
  La verifica usa `requireUserVerification: false` (accetta anche authenticator senza PIN),
  con `userVerification: 'preferred'` nelle options.
- Test: `packages/server/test/passkeys.test.ts` (migrazione v6, CRUD, options, flusso WS).

Nota: il login con passkey funziona anche dalla pagina `/login` standalone (pulsante 🔑 Passkey) via endpoint HTTP pubblici `/api/passkey/options` + `/api/passkey/verify` (challenge monouso, 3 min, rate limit per IP `DND5E_PASSKEY_MAX_ATTEMPTS`, audit `login-passkey`).
## Protocollo (JSON su WebSocket)

Client→Server: `create`, `join` (con `role: 'master'` per rientrare come master quando
nessun master è collegato), `list`, `ping` (check connessione, con `id` ecoato),
`register` / `login` (account con **password verificata lato server**, hash scrypt con sale),
`adminAuth` / `adminList` / `adminCreateCampaign` / `adminUpdateCampaign` /
`adminDeleteCampaign` / `adminDeleteAccount` (pannello admin), `action` (setCharacter,
startCombat, addEnemy, rollInitiative, attack, move, useBonus, useReaction, setCondition,
damage, heal, nextTurn, endCombat, addCustom, leave, **saveCharacter**, **deleteCharacter**,
**useCharacter**, **deleteCampaign** (solo master: elimina la campagna),
**masterDamage / masterHeal / masterAddXp / masterSetCondition** —
azioni del master "segrete", non scritte nel log pubblico)

Server→Client: `welcome`, `state` (broadcast a ogni cambiamento), `campaigns`, `auth`
(token + libreria schede dell'account), `pong` (risposta al ping, con `serverTime`),
`campaignDeleted` (la campagna è stata eliminata), `error`

## Login richiesto per il sito (DND5E_REQUIRE_AUTH)

Con `DND5E_REQUIRE_AUTH=true` (default nei compose Docker) la webapp servita dal server **richiede un account**:
senza cookie di sessione valido (`dnd5e_session`, impostato da `POST /api/login` o `/api/login-token`) ogni GET
serve una pagina di login standalone (`public/login.html`) al posto dell'app — anche `/login` stesso serve
quella pagina (mai l'SPA, per evitare loop con `/api/me`), mentre con sessione valida `/login` redirecta (302)
all'app `/`; `/api/info`, `/api/setup`, `/setup`, `/api/login`, `/api/register`, `/api/logout`, `/api/me`,
`/version.json`, `/api/update*` restano pubblici (`/admin` ha il suo gate, vedi sotto).
Le pagine statiche login/setup/invite/admin condividono lo **stesso tema D&D** dell'app web;
dopo il logout (`/api/logout`) la webapp servita dal server torna **automaticamente** a `/login`.
**Primo avvio con zero account**: `/` e `/login` redirectano (302) a `/setup`, che mostra il processo di
creazione del primo admin (la pagina di login fa lo stesso controllo via `GET /api/setup`).
Sui WebSocket, con require-auth attivo, `create`/`join`/`action`/`list`/i messaggi P2P richiedono la sessione:
il browser la passa via cookie sull'upgrade e in quel caso il server manda subito `auth` (la webapp risulta
già loggata: niente form user/password nelle tab home/campagna); le app native fanno `login`/`loginToken` a mano.
Le app native (AppImage/APK/desktop) non passano dal sito servito: restano fully standalone, il login sul server è facoltativo.

Hardening attivo (utile quando il server è esposto su HTTPS dietro reverse proxy):
- cookie di sessione `HttpOnly; SameSite=Lax` e **`Secure`** quando la richiesta è HTTPS
  (TLS diretto o header `X-Forwarded-Proto: https` passato dal proxy); **HSTS** solo in quel caso;
- header di sicurezza su tutte le risposte (`X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`/CSP `frame-ancestors 'none'`, CSP restrittiva, `Permissions-Policy`);
- controllo **Origin** sull'upgrade WebSocket (anti cross-site WebSocket hijacking): respinto (403) se
  l'origin non combacia con `Host`/`X-Forwarded-Host`/`DND5E_RP_ORIGIN` (i client non-browser senza Origin passano);
- **rate limit** sui login falliti: max `DND5E_LOGIN_MAX_ATTEMPTS` (default 10) al minuto per username+IP
  (HTTP `/api/login`, WS `login`) e per IP su `/api/register` (`DND5E_REGISTER_MAX_ATTEMPTS`, default 5),
  `/api/invite` (`DND5E_INVITE_MAX_ATTEMPTS`, default 10) e `/api/login-token` -> 429;
- **`/.well-known/security.txt`** (RFC 9116) sempre pubblico, anche con require-auth: punta a `SECURITY.md`;
- **allowlist IP admin** `DND5E_ADMIN_ALLOWLIST` (IP o CIDR IPv4, es. `192.168.1.0/24,10.0.0.5`):
  se impostata, `/admin`, `adminAuth` WS e `POST /api/update/apply` rispondono 403 agli IP fuori lista
  (a prescindere da sessione/token). Dietro reverse proxy impostare `DND5E_TRUST_XFF=true` per far
  contare `X-Forwarded-For` (il socket vede solo l'IP del proxy). `/api/info` espone `adminAllowlist`;
- **2FA admin**: il pannello `/admin` (card 🔐 Sicurezza) avvisa se un account admin non ha TOTP né
  passkey; ogni login admin senza 2FA viene registrato nell'audit log come `admin-login-no-2fa`;
- password salvate con **scrypt + sale** (`scrypt$N$r$p$sale$hash`); i vecchi hash sha256 restano
  verificabili e vengono aggiornati a scrypt al primo login riuscito.

## Registrazione: aperta, con approvazione o solo su invito

- `DND5E_REGISTRATION=approval` (default): `register` crea solo una *richiesta* approvata dall'admin in `/admin`.
- `DND5E_REGISTRATION=open`: `register` crea subito l'account (e fa login immediato); via HTTP `POST /api/register`.
- `DND5E_REGISTRATION=invite` (**solo su invito**): `register`/`POST /api/register` sono **chiusi** (403
  "solo su invito"); si registra solo da un link di invito creato dall'admin (vedi sotto).
- L'admin può cambiare modalità dal pannello (`adminSetRegistration`, persistito in `accounts.data`);
  `/api/info` espone `registration` e `requireAuth`.
- **Priorità**: il valore salvato dal pannello `/admin` vince sull'env `DND5E_REGISTRATION` (che resta solo
  il valore iniziale/default, es. dal compose) e persiste ai riavvii; default `approval`.
- La modalità è **visibile nell'app**: tag "solo su invito / aperta / con approvazione" nella card account
  (tab Home e Campagna, da `/api/me` o `/api/info`); in modalità invito il pulsante "Registrati" è nascosto
  e al suo posto appare il suggerimento di chiedere il link `/invite?token=…` (la pagina `/login` nasconde
  la tab "Registrati").

### Inviti (modalità "solo su invito")

L'admin crea un link dal pannello `/admin` → "Inviti" (`adminCreateInvite { ttlHours? }`, default 24h,
max 7 giorni; `DND5E_INVITE_TTL_HOURS` per il default): il server risponde `inviteCreated { token, id,
expiresAt, url: '/invite?token=…' }`. Il token è random a 256 bit e **mai salvato in chiaro** (solo hash
sha256 in `accounts.data`), è **univoco**, **a scadenza** e **monouso**.

- Pagina pubblica `GET /invite?token=…` (come `/login`, serve anche con `DND5E_REQUIRE_AUTH`): mostra il form
  di registrazione solo se l'invito è valido.
- `GET /api/invite?token=…` → `{ valid: true, expiresAt }` oppure `{ valid: false, reason: 'invalid'|'used'|'expired' }`.
- `POST /api/invite { token, username, password, remember? }` → crea l'account (ruolo `user`, o `admin` se
  `DND5E_ADMIN_USER`), **marca l'invito come usato** (un secondo uso → 403 "già usato"), imposta il cookie di
  sessione (auto-login) e risponde come `/api/login`. Rate limit per IP come `/api/register`.
- L'admin vede gli inviti in `adminState.invites` (id mascherato, creazione, scadenza, stato) e può revocarli
  prima della scadenza con `adminRevokeInvite { inviteId }`. Gli inviti scaduti vengono ripuliti automaticamente.

## Mantieni l'accesso (remember me)

`login`/`loginTotp`/`loginTotpBackup` con `remember: true` ritornano in `auth` un `rememberToken` persistente
(hash salvato sull'account, max 10); il client lo tiene in localStorage e al prossimo avvio manda
`loginToken { token }` per rientrare senza password. Stesso flusso via HTTP: `POST /api/login-token`.

## Account, richieste e libreria schede

- `register { username, password }` **in modalità approval** non crea subito l'account: registra una *richiesta*
  (in `accounts.data`, con hash scrypt della password) e risponde `notice`; l'admin la vede
  in `/admin` → "Richieste di registrazione" e la **approva** (`adminApproveAccount`) o
  **rifiuta** (`adminRejectAccount`). Solo dopo l'approvazione il login funziona.
- `login { username, password }` → `auth { token, username, characters }`; la password è
  **verificata lato server** (scrypt con sale su disco, mai in chiaro; account legacy senza
  hash impostano la password alla prima login). Sessioni in memoria (token → username).
  Con `password` vuota/assente e sessione cookie valida, `login { username }` rienvia solo `auth`
  (resume sessione, es. riconnessione automatica della webapp servita dal server).
- `saveCharacter` / `deleteCharacter` salvano la scheda nella libreria dell'account
  (persistente in `accounts.data`); `useCharacter` la carica in campagna
- il master può eliminare la campagna con l'azione `deleteCampaign` (tutti ricevono
  `campaignDeleted`); l'admin gestisce campagne e account da `/admin`:
  crea/modifica/elimina campagne, approva/rifiuta richieste, vede ed elimina le singole
  schede di un account (`adminAccountDetail` / `adminDeleteCharacter`), e vede info del
  server (uptime, conteggi, indirizzi LAN) in `adminState.server`

## Persistenza e regole per campagna

- Campagne salvate in `data/campaigns/<id>.json` (modifica con `DND5E_DATA_DIR`);
  gli account in `accounts.data` nella stessa cartella (override con `DND5E_ACCOUNTS_FILE`)
- Ogni campagna ha i suoi **contenuti custom** (`addCustom` dal master) che vengono
  uniti al set SRD nel registry del server — la campagna può avere il "suo set di regole, classi e razze"
- Le house-rules della campagna sono nel modello (`campaign.houseRules`)

## Setup iniziale (primo avvio)

- In **Docker** l'entrypoint (`docker/entrypoint.sh`) genera `DND5E_ADMIN_TOKEN` se mancante:
  lo stampa nei log del container e lo salva in `/data/admin-token.txt` (chmod 600).
  ```bash
  docker compose logs 5emanager | grep -A3 'Token admin'
  # oppure: docker exec 5emanager-server cat /data/admin-token.txt
  ```
- Con **zero account**, `/` e `/login` redirectano a `/setup` (pagina) e `POST /api/setup` crea il primo
  account (sempre **admin**). `/api/setup` è abilitato solo finché non esistono account (le richieste di
  registrazione *pending* non contano: non devono poter occupare il setup su un server pubblico fresco);
  se `DND5E_ADMIN_TOKEN` è impostato richiede l'header `x-admin-token` (niente race su server pubblici appena
  esposti). Dopo la creazione la pagina fa login automatico e porta nell'app.
  Il pannello `/admin` mostra un banner verso `/setup` finché non c'è nessun account.
- Il token admin protegge anche `POST /api/update/apply` (self-update web) e i messaggi `adminAuth`.

## Pannello admin del server (`/admin`)

Il server serve una pagina di amministrazione su `http://<server>:3001/admin` (funziona anche
senza build della web app): elenca campagne (con stato combattimento) e account, con
eliminazione. I comandi admin viaggiano sullo stesso WebSocket (`adminAuth`/`adminList`/
`adminDeleteCampaign`/`adminDeleteAccount`).

### Sessioni e dispositivi (gestione da `/admin`)

Le sessioni sono in memoria (token → username, perse al riavvio); i **dispositivi** sono i token
"mantieni l'accesso" persistenti (`accounts.data` v9: record `{ hash, createdAt, lastUsedAt }`, solo hash,
max 10 per account). Dal pannello `/admin` → dettaglio account ("🔑 Dispositivi e sessioni"):
- `adminAccountDetail { username }` → `adminAccount` con `devices`, `activeSessions`, `sessionsRevokedAt`;
- `adminRevokeDevice { username, tokenId }` revoca un singolo dispositivo (il suo login-token smette di funzionare);
- `adminRevokeAllDevices { username }` revoca tutti i "mantieni l'accesso" dell'account;
- `adminRevokeSessions { username }` imposta `sessionsRevokedAt`: tutte le sessioni in-memory create prima di quell'istante
  vengono invalidate (`sessionUsername` le rifiuta — il cookie smette di valere subito, anche su WS).
Tutte le revoche finiscono nell'audit log.

### Audit log

Ogni evento di sicurezza/amministrazione è appenduto come riga JSON su **`audit.log`** in
`DND5E_DATA_DIR` (ruotato su `audit.log.1` oltre `DND5E_AUDIT_MAX_BYTES`, default 5 MB; mai password/token
nei dettagli): `first-admin`, `login` / `login-failed` / `login-token-failed` / `login-passkey` (HTTP e WS,
con IP), `register` / `register-request`, `invite-create` / `invite-used` / `invite-failed`, `logout`,
`adminauth-failed`, tutte le azioni `admin*` réusscite (con actor e dettaglio), `update-apply`.
L'admin legge gli ultimi eventi via WS `adminAudit { limit? }` → `auditLog { entries }` (pannello `/admin` →
card "Audit log"); `adminAudit` è come le altre azioni admin: solo sessione admin o token valido.

**Gate della pagina `/admin`** (la pagina non è mai pubblica):
- con `DND5E_REQUIRE_AUTH=true`: senza sessione → 302 a `/login`; sessione di account **non admin** → 403;
  sessione di account **admin** → 200;
- senza REQUIRE_AUTH ma con `DND5E_ADMIN_TOKEN`: serve il token (`/admin?token=…` o header `x-admin-token`), altrimenti 403;
- senza né REQUIRE_AUTH né token: aperta solo finché non esistono account (LAN fresca, flusso `/setup`).

Su WebSocket `adminAuth` vale con **token admin valido** (`DND5E_ADMIN_TOKEN`) **oppure** sessione di account
admin; senza token configurato è accettata solo su server fresco (zero account). Gli altri messaggi
`admin*` richiedono `conn.admin`. Anche `POST /api/update/apply` (self-update) con REQUIRE_AUTH è
riservato a sessione admin o `x-admin-token` (altrimenti 403).

Il pannello mostra ora anche **statistiche**: per account numero login e ultimo login, 2FA attiva,
passkey registrate, campagne P2P salvate, schede in libreria; per campagna numero di schede caricate;
totali del server (schede, campagne P2P). Azioni admin extra: **2FA off** e **rimuovi passkey** per utente.
Dall'app, chi è loggato con ruolo **admin** vede il pulsante 🛡️ "Pannello admin" ( apre `/admin` in una
nuova scheda); dal pannello il link "⬅️ App" torna all'app con le proprie schede. `auth` ora include `role`.

## Pannello master nell'app

Il master vede in campagna le schede di tutti i giocatori (PF, CA, XP, condizioni,
caratteristiche, competenze, note) e può applicare **di nascosto** danni, cure, XP e
condizioni (`masterDamage`/`masterHeal`/`masterAddXp`/`masterSetCondition`): queste azioni
aggiornano la scheda del giocatore (e il combattente, se in combattimento) **senza** voce
nel log pubblico.

## Sicurezza

Pensato per **LAN / rete privata / tailscale**: password di campagna e di account (sha256,
verificate lato server) e pannello admin protetto da `DND5E_ADMIN_TOKEN` (se impostata).
Su LAN la password viaggia in chiaro sul WebSocket: **non esporlo su Internet pubblico senza
un reverse proxy con TLS** (wss) + auth aggiuntiva. Per proteggere le schede offline in
locale c'è il blocco app con password locale (lato client, vedi web app).
