#!/usr/bin/env python3
"""Patch firma RELEASE (CI): se keystore.jks esiste (da secret ANDROID_KEYSTORE_B64),
aggiunge signingConfigs.release in app/build.gradle e lo collega a buildTypes.release.
Funziona anche se patch_android.py ha gia' aggiunto signingConfigs.debug (inserisce release
nel blocco esistente). Uso:
  echo "$ANDROID_KEYSTORE_B64" | base64 -d > apps/web/android/keystore.jks
  python3 apps/web/android-overlay/patch_signing.py apps/web/android
Le password arrivano da env (ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD).
"""
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
g = (root / "app" / "build.gradle").read_text()

if "keystore.jks" in g:
    print("signing release gia' presente")
    sys.exit(0)

release_block = (
    "\n        release {\n"
    "            storeFile file('../keystore.jks')\n"
    "            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD') ?: ''\n"
    "            keyAlias System.getenv('ANDROID_KEY_ALIAS') ?: ''\n"
    "            keyPassword System.getenv('ANDROID_KEY_PASSWORD') ?: ''\n"
    "        }\n"
)

sc = g.find("signingConfigs {")
if sc >= 0:
    # Inserisci release dentro il blocco signingConfigs esistente: trova la sua } di chiusura
    open_b = g.find("{", sc)
    depth = 0
    i = open_b
    while i < len(g):
        if g[i] == "{":
            depth += 1
        elif g[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    if depth != 0:
        raise SystemExit("ERRORE patch_signing: blocco signingConfigs mal formato in app/build.gradle")
    g = g[:i] + release_block + g[i:]
else:
    block = "\n    signingConfigs {" + release_block + "    }\n"
    if "android {" in g:
        g = g.replace("android {", "android {" + block, 1)
    else:
        g = "android {" + block + "\n" + g

# collega buildTypes.release a signingConfigs.release
if "signingConfig signingConfigs.release" not in g:
    bt = g.find("buildTypes {")
    rel = g.find("release {", bt) if bt >= 0 else -1
    if rel >= 0:
        line_end = g.find("\n", rel)
        g = g[: line_end + 1] + "            signingConfig signingConfigs.release\n" + g[line_end + 1 :]
    else:
        g = g.replace(
            "buildTypes {",
            "buildTypes {\n        release {\n            signingConfig signingConfigs.release\n        }",
            1,
        )

(root / "app" / "build.gradle").write_text(g)
print("signing release configurato (keystore.jks -> ../keystore.jks, password da env)")
