# iOS (Capacitor) — guida rapida

L'app web è già pronta per iOS: basta avvolgere la build con Capacitor. Serve un **Mac con Xcode**
(per build/firma) e, per la pubblicazione, un **Apple Developer Program** (99$/anno).

## Prerequisiti

- macOS + Xcode (ultima versione stabile) + Command Line Tools (`xcode-select --install`)
- Node 22 (`npm ci` nella root del repo)
- Account Apple Developer (solo per firma e distribuzione; per testare su iPhone personale bastano i permessi da Xcode con Apple ID gratuita)

## Build

```bash
npm ci
npm run build -w @dnd5e/web          # genera apps/web/dist
npx cap add ios                       # solo la prima volta: crea apps/web/ios (gitignored, come android)
npx cap sync ios                      # copia la build web nel progetto iOS
npx cap open ios                      # apre apps/web/ios/App/App.xcworkspace in Xcode
```

In Xcode:

1. Seleziona il target **App** → tab **Signing & Capabilities** → imposta **Team** (il tuo Apple ID / team pago)
   e un **Bundle Identifier** unico (es. `it.tuominio.cinqueemanager`).
2. Tab **General** → versione/build come in `apps/web/package.json`.
3. **Product → Scheme → Edit Scheme → Run → Info → Launch: Default** (se vuoi deep link/QR funzionanti verifica gli scheme in `Info.plist`).
4. Seleziona un dispositivo reale (o un simulatore) → **Product → Run** (⌘R) per il test, oppure
   **Product → Archive** per la distribuzione.

## Distribuzione

- **TestFlight**: da App Store Connect, carica l'archive (Xcode → Window → Organizer → Distribute App → App Store Connect → Upload), poi invita i tester.
- **App Store**: stessa procedura, poi compila la scheda prodotto e passa la review.

## Note

- `apps/web/ios/` è gitignored (come `apps/web/android/`): il progetto nativa si ricrea con `cap add ios` + `cap sync ios`.
- Permessi (fotocamera per i QR, notifiche per i promemoria): Capacitor li chiede a runtime; i testi in `Info.plist` (`NSCameraUsageDescription`, `NSUserNotificationsUsageDescription`) vanno impostati in Xcode → target App → Info.
- Aggiornamenti: basta `npm run build -w @dnd5e/web && npx cap sync ios` e ricompilare; la webview carica la nuova build (il service worker aggiorna la cache alla successiva apertura).
- Deep link/QR: vedi `apps/web/src/deepLink.ts` (scheme `5ELAN:`/`5EP2P1:` configurati in `capacitor.config.ts`).
