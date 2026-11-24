# 5emanager-bin — pacchetto AUR

Pacchetto **binario** per Arch Linux: prende l'AppImage ufficiale published nella
[release GitHub](https://github.com/Tecmat/5emanager/releases) (asset con nome stabile
`5emanager-<versione>-x86_64.AppImage`, aggiunto dal job `desktop` di `release.yml`).

## Uso

```bash
yay -S 5emanager-bin     # o paru -S 5emanager-bin
5emanager               # avvia l'AppImage da /opt/5emanager-bin
```

Dipendenze runtime: `fuse2` (per montare l'AppImage) + `webkit2gtk-4.1`, `gtk3`, `librsvg`,
`libayatana-appindicator` (Tauri v2). Se fuse2 manca, l'AppImage si può sempre estrarre:
`./5emanager.AppImage --appimage-extract-and-run`.

## Pubblicazione su AUR (manutentore)

1. Clona il repo AUR: `git clone ssh://aur@aur.archlinux.org/5emanager-bin.git`
2. Copia qui dentro `PKGBUILD`, `.SRCINFO`, `5emanager.desktop`, `5emanager.png`
3. Ad ogni release: aggiorna `pkgver`/`pkgrel` in `PKGBUILD` e `sha256sums` con l'hash
   dell'asset `5emanager-<pkgver>-x86_64.AppImage`, poi rigenera `.SRCINFO`:
   `makepkg --printsrcinfo > .SRCINFO`
4. `makepkg -sf` per verificare, poi commit + push su AUR.

La CI (job `aur` in `.github/workflows/ci.yml`) valida il parse del PKGBUILD in un
container `archlinux:base-devel` ad ogni push.

L'auto-aggiornamento in-app continua a usare l'asset `5e.Manager_<ver>_amd64.AppImage`
(stesso contenuto, nome "classico" di Tauri).
