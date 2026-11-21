#!/usr/bin/env python3
"""Patch firma release (CI): se keystore.jks esiste (da secret ANDROID_KEYSTORE_B64),
aggiunge signingConfigs.release in app/build.gradle. Uso:
  echo "$ANDROID_KEYSTORE_B64" | base64 -d > apps/web/android/keystore.jks
  python3 apps/web/android-overlay/patch_signing.py apps/web/android
Le password llegan da env (ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD).
"""
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
g = (root / "app" / "build.gradle").read_text()
if "signingConfigs" in g:
    print("signing già presente")
    sys.exit(0)
block = """
    signingConfigs {
        release {
            storeFile file('../keystore.jks')
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD') ?: ''
            keyAlias System.getenv('ANDROID_KEY_ALIAS') ?: ''
            keyPassword System.getenv('ANDROID_KEY_PASSWORD') ?: ''
        }
    }
"""
if "android {" in g:
    g = g.replace("android {", "android {" + block, 1)
else:
    g = "android {" + block + "\n" + g
if "signingConfig signingConfigs.release" not in g:
    g = g.replace(
        "buildTypes {",
        "buildTypes {\n        release {\n            signingConfig signingConfigs.release\n        }",
        1,
    )
(root / "app" / "build.gradle").write_text(g)
print("signing release configurato (keystore.jks -> ../keystore.jks, password da env)")
