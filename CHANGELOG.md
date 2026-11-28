# Changelog

Tutte le versioni notevoli di 5e Manager. Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); le novità vengono mostrate anche in-app al cambio di versione (`apps/web/src/news.ts`).

## [0.2.0] — in preparazione

### Aggiunto
- **Versionamento delle schede**: snapshot persistenti per scheda (auto max 1/ora, manuale con etichetta, automatico prima del level-up) con ripristino ed eliminazione — `apps/web/src/versions.ts`, card in Panoramica.
- **Storico dei tiri del combattimento** (`rollHistory`, cap 200): attacchi, danni e initiative registradosi con round, attore e bersaglio; card 🎲 Tiri in locale e online (`CombatLog.tsx`).
- **Editor incantesimi custom**: campo upcast (`higherLevel`) con anteprima dei dadi extra per slot.
- **Accessibilità**: focus visibile, `aria-current` sulle tab attive, aria-label sui bottoni solo-icona, rispetto di `prefers-reduced-motion`.
- **Dado animato** con totale che "rotola" durante il tiro e suono opzionale (toggle 🔊/🔇 persistente, WebAudio senza asset).
- **Test e2e multiplayer**: server di gioco in CI + host via app e player via WebSocket (XP del master verificato end-to-end).
- **Audit automatico dei dati SRD** in CI: validazione di tutte le definizioni, 12 classi PHB, ≥3 archetipi per classe, incantesimi/razze/nemici/background.
- **CHANGELOG.md** pubblico e dialog **"Novità"** in-app al cambio di versione.

### Corretto
- Validazione upcast troppo restrittiva (testi descrittivi senza `+NdM`) e arma con danno `-` (es. rete).

## [0.1.97]

### Aggiunto
- **Pronto per il Play Store**: AAB release-signed nelle release GitHub; self-update in-app rimosso per AAB/APK (gli aggiornamenti passano da Play) e rimossa la permission `REQUEST_INSTALL_PACKAGES`.
- **Moderazione lato server**: blocca/segnala giocatore (core + server + P2P) e log di moderazione JSONL attivabile (`DND5E_MODERATION_LOG`); panneau "Moderation log" in `/admin`.
- **Validazione server-side delle immagini PG**: allowlist data-URL (png/jpeg/webp/gif), magic bytes, max 1 MiB e dimensioni ≤ 4096 px.
- **Background come entità SRD** (13 background) con competenze automatiche in creazione.
- Icone e feature graphic per il Play Store (512×512, 1024×500).

### Cambiato
- Pulsante update solo dove serve: desktop sempre, web solo admin loggato, APK solo badge di versione.
- Fix UI sotto la barra di navigazione Android (safe-area), PDF scheda in stile pergamena, export JSON su AppImage via comando Tauri `save_text_file`.
- Documentazione pubblica e neutra (niente istruzioni private di publishing nel repo; runbook in `docs-private/` ignorata da git).

## [0.1.x] — 0.1.52 → 0.1.96 (riepilogo)

- Multiplayer P2P LAN (QR/codice invito, discovery, resume campagne) e server WS con auth, 2FA TOTP, passkey WebAuthn, ruoli admin, pannello `/admin`.
- Campagne online: combattimento con mappa tattica e template, timer di turno, chat, log/statistiche, inventario e tesoreria di gruppo, note di sessione, XP a tutta la party, kick/blocco/segnalazione giocatori, riconnessione automatica.
- Schede: creazione (array standard/point-buy/4d6), level-up con talenti e archetipi, incantesimi con upcast e preferiti, inventario con equipaggiamento/attunement/negozio/crafting, riposo breve/lungo, diario di sessione, undo, export/import libreria e PDF, import da D&D Beyond, pregen, simulazione al liv 20.
- Piattaforme: PWA offline (service worker), desktop Tauri (Windows/macOS/Linux) con self-update, Android Capacitor con AAB per Play Store.
- Sicurezza: rate limit, audit log, hardening HTTPS (`security.txt`, allowlist admin), moderazione.
- Test: suite vitest (core/server/web) + e2e Playwright in CI; immagini Docker su GHCR.

[0.2.0]: https://github.com/Tecmat/5emanager/releases/tag/v0.2.0
[0.1.97]: https://github.com/Tecmat/5emanager/releases/tag/v0.1.97
