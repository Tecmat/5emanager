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
6. Master può: rilanciare initiative, infliggere/curare PF, aggiungere condizioni, terminare il combattimento

## Protocollo (JSON su WebSocket)

Client→Server: `create`, `join` (con `role: 'master'` per rientrare come master quando
nessun master è collegato), `list`, `ping` (check connessione, con `id` ecoato),
`register` / `login` (account per username), `adminAuth` / `adminList` /
`adminDeleteCampaign` / `adminDeleteAccount` (pannello admin), `action` (setCharacter,
startCombat, addEnemy, rollInitiative, attack, move, useBonus, useReaction, setCondition,
damage, heal, nextTurn, endCombat, addCustom, leave, **saveCharacter**, **deleteCharacter**,
**useCharacter**, **masterDamage / masterHeal / masterAddXp / masterSetCondition** —
azioni del master "segrete", non scritte nel log pubblico)

Server→Client: `welcome`, `state` (broadcast a ogni cambiamento), `campaigns`, `auth`
(token + libreria schede dell'account), `pong` (risposta al ping, con `serverTime`), `error`

## Account e libreria schede

- `register { username }` / `login { username }` → `auth { token, username, characters }`;
  le sessioni sono in memoria (token → username) e si perdono al riavvio del server
- **Le password degli account per ora sono SOLO lato client**: il server registra/accede
  per username e non le vede mai (TODO verifica lato server). L'hash sha256 resta nel
  localStorage del browser.
- `saveCharacter` / `deleteCharacter` salvano la scheda nella libreria dell'account
  (persistente in `accounts.data` dentro la data dir); `useCharacter` la carica in campagna
  al posto di `setCharacter`

## Persistenza e regole per campagna

- Campagne salvate in `data/campaigns/<id>.json` (modifica con `DND5E_DATA_DIR`);
  gli account in `accounts.data` nella stessa cartella (override con `DND5E_ACCOUNTS_FILE`)
- Ogni campagna ha i suoi **contenuti custom** (`addCustom` dal master) che vengono
  uniti al set SRD nel registry del server — la campagna può avere il "suo set di regole, classi e razze"
- Le house-rules della campagna sono nel modello (`campaign.houseRules`)

## Pannello admin del server (`/admin`)

Il server serve una pagina di amministrazione su `http://<server>:3001/admin` (funziona anche
senza build della web app): elenca campagne (con stato combattimento) e account, con
eliminazione. I comandi admin viaggiano sullo stesso WebSocket (`adminAuth`/`adminList`/
`adminDeleteCampaign`/`adminDeleteAccount`). Se la variabile d'ambiente
**`DND5E_ADMIN_TOKEN`** è impostata, `adminAuth` deve contenere quel token; se non è
impostata l'accesso è libero (ok per LAN — vedi sotto).

## Pannello master nell'app

Il master vede in campagna le schede di tutti i giocatori (PF, CA, XP, condizioni,
caratteristiche, competenze, note) e può applicare **di nascosto** danni, cure, XP e
condizioni (`masterDamage`/`masterHeal`/`masterAddXp`/`masterSetCondition`): queste azioni
aggiornano la scheda del giocatore (e il combattente, se in combattimento) **senza** voce
nel log pubblico.

## Sicurezza

Pensato per **LAN / rete privata / tailscale**: password di campagna (sha256), account per
username (password ancora solo lato client) e pannello admin optionally protetto da
`DND5E_ADMIN_TOKEN`. Non esporlo su Internet pubblico senza un reverse proxy con TLS +
auth aggiuntiva.
