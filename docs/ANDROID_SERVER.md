# Server direttamente su Android (Termux)

Sì: il server (`packages/server`, Node puro) gira su Android dentro **Termux**.
Così il telefono diventa l'host della campagna: gli altri giocatori si connettono
al suo IP nella rete Wi-Fi.

## Passaggi (una volta)

```bash
# 1) Termux: installa Node e git
pkg update && pkg install -y nodejs-lts git

# 2) clona il repo (privato: usa un token come password, vedi README)
git clone https://github.com/Tecmat/5emanager.git
cd 5emanager
git checkout vibe/dnd5e-scheda-f0caaa

# 3) dipendenze + build della web app da servire
npm install
npm run build -w @dnd5e/web
# (se la build web fallisse su ARM: scarica l'artefatto "web-dist" dalla release
#  GitHub v0.1.6 e scompattalo in apps/web/dist)

# 4) avvia il server
termux-wake-lock          # impedisce che Android addormenti il telefono
npm run server            # http://0.0.0.0:3001
```

All'avvio il server stampa gli indirizzi LAN, es.:

```
📱 LAN: http://192.168.1.50:3001   (WebSocket: ws://192.168.1.50:3001)
```

## Collegare i giocatori

- Gli altri dispositivi (PC, altri telefoni con l'APK) aprono `http://192.168.1.50:3001/`
  → la web app, oppure nell'**APK** tab 🌐 Campagna → server `ws://192.168.1.50:3001`
- Stessa rete Wi-Fi richiesta; per Internet pubblico serve un tunnel/VPS (non esporlo così com'è).

## Variabili utili

```bash
PORT=8080 npm run server                  # porta diversa
DND5E_DATA_DIR=/sdcard/campagne npm run server   # salva le campagne sulla memoria interna
HOST=127.0.0.1 npm run server             # solo localhost
```

## Note

- `npm run server` usa `tsx` (devDependency): su Termux va bene, oppure compila prima
  (`npx tsc -p packages/server/tsconfig.json` con `outDir`) se vuoi solo JS.
- La build web su Android ARM64 funziona (esbuild ha il binario `android-arm64`);
  in caso di problemi usa il fallback con l'artefatto `web-dist` della release.
