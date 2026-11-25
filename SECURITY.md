# Security Policy — 5e Manager

## Segnalare una vulnerabilità

Non aprire issue pubbliche per vulnerabilità: scrivi a **security@tecmat.it** (o apri un
[Security Advisory](https://github.com/Tecmat/5emanager/security/advisories/new) privato su GitHub)
con una descrizione riproducibile. Ti rispondiamo entro 72 ore e, dopo la conferma, pubblichiamo
la fix con un credito nel changelog della release.

## Ambito

Ci interessa in particolare: bypass del gate `/admin` o dell'autenticazione (sessione cookie,
token admin, passkey, 2FA TOTP), accesso a dati di altri account (libreria schede, campagne),
WebSocket senza Origin valido, path traversal nello static/self-update, iniezione nelle pagine
standalone (login/setup/invite/admin), rate-limit bypass, exposure di token/segreti nei log.

## Buone pratiche per il self-hosting

- Esporre il server **solo su HTTPS** dietro reverse proxy (vedi `docs/DOCKER.md`): il server imposta
  cookie `Secure` + HSTS e controlla l'Origin dei WebSocket quando vede `X-Forwarded-Proto: https`.
- Impostare `DND5E_ADMIN_TOKEN` (l'entrypoint Docker lo genera se manca) e tenerlo segreto.
- `DND5E_REQUIRE_AUTH=true` (default nei compose): niente accesso al sito senza account.
- Per il pannello admin da LAN fidata: `DND5E_ADMIN_ALLOWLIST` (IP/CIDR) limita `/admin`,
  `adminAuth` e self-update a certi IP; dietro proxy `DND5E_TRUST_XFF=true` per usare
  `X-Forwarded-For`.
- Attivare 2FA (TOTP o passkey) **soprattutto sugli account admin**: il pannello `/admin` avvisa
  (card Sicurezza) e l'audit log registra i login admin senza 2FA.
- Aggiornare sempre all'ultima release: `docker compose pull && docker compose up -d` (o rebuild
  locale) — le fix di sicurezza arrivano lì.
- I dati persistenti (`DND5E_DATA_DIR`) contengono account e campagne: proteggi il volume Docker.

## Versioni supportate

Solo l'ultima release (`main` + ultimo tag `vX.Y.Z`) riceve fix di sicurezza.
