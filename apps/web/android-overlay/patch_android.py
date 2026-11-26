#!/usr/bin/env python3
"""Patch del progetto Android generato da Capacitor (CI): aggiunge i plugin UpdateInstaller
(download + installazione APK in-app) e LanBeacon (host P2P LAN stile Soul Knight:
mini server HTTP+WS sul dispositivo), il FileProvider e i permessi necessari.
Uso: python3 apps/web/android-overlay/patch_android.py apps/web/android
"""
import pathlib
import re
import shutil
import sys

root = pathlib.Path(sys.argv[1])
overlay = pathlib.Path(__file__).parent

# 1) AndroidManifest.xml: permesso REQUEST_INSTALL_PACKAGES + FileProvider
manifest = root / "app/src/main/AndroidManifest.xml"
s = manifest.read_text()
PERMS = [
    "android.permission.REQUEST_INSTALL_PACKAGES",
    "android.permission.CAMERA",
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.ACCESS_WIFI_STATE",
]
for p in PERMS:
    if p not in s:
        s = re.sub(
            r"(<manifest[^>]*>)",
            r'\1\n    <uses-permission android:name="' + p + '" />',
            s,
            count=1,
        )
if "fileprovider" not in s:
    provider = (
        "\n        <provider\n"
        '            android:name="androidx.core.content.FileProvider"\n'
        '            android:authorities="${applicationId}.fileprovider"\n'
        '            android:exported="false"\n'
        '            android:grantUriPermissions="true">\n'
        '            <meta-data\n'
        '                android:name="android.support.FILE_PROVIDER_PATHS"\n'
        '                android:resource="@xml/file_paths" />\n'
        "        </provider>\n"
        "    </application>"
    )
    s = s.replace("</application>", provider, 1)
# cleartext: l'app gira su https://localhost e deve parlare http/ws con la LAN (server 3001, beacon 3177)
if "usesCleartextTraffic" not in s:
    s = s.replace("<application", '<application android:usesCleartextTraffic="true"', 1)
# camera non obbligatoria (Play Store non filtra i dispositivi senza fotocamera)
if "uses-feature" not in s:
    s = re.sub(
        r"(<manifest[^>]*>)",
        r'\1\n    <uses-feature android:name="android.hardware.camera" android:required="false" />',
        s,
        count=1,
    )
# 1c) deep link: il QR "5ELAN:ws://..." / "5EP2P1:..." scansionato con la fotocamera di
# sistema apre direttamente l'app (intent-filter VIEW/BROWSABLE sugli scheme, activity launcher)
if "5elan" not in s.lower():
    deep = (
        "\n            <intent-filter>\n"
        '                <action android:name="android.intent.action.VIEW" />\n'
        '                <category android:name="android.intent.category.DEFAULT" />\n'
        '                <category android:name="android.intent.category.BROWSABLE" />\n'
        '                <data android:scheme="5elan" />\n'
        '                <data android:scheme="5ELAN" />\n'
        '                <data android:scheme="5ep2p1" />\n'
        '                <data android:scheme="5EP2P1" />\n'
        '                <data android:scheme="5ecode" />\n'
        '                <data android:scheme="5ECODE" />\n'
        "            </intent-filter>"
    )
    idx = s.find("android.intent.category.LAUNCHER")
    end = s.find("</intent-filter>", idx) if idx >= 0 else -1
    if end >= 0:
        pos = end + len("</intent-filter>")
        s = s[:pos] + deep + s[pos:]
    else:
        m = re.search(r"(<activity[^>]*>)", s)
        if m:
            s = s[: m.end()] + deep + s[m.end():]
manifest.write_text(s)

# 1b) icone app (d20 "candy"): launcher legacy in tutte le density + adaptive icon v26
icons = overlay / "icons"
res = root / "app/src/main/res"
for dpi in ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]:
    dst = res / f"mipmap-{dpi}"
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copy(icons / f"ic_launcher-{dpi}.png", dst / "ic_launcher.png")
    shutil.copy(icons / f"ic_launcher-{dpi}.png", dst / "ic_launcher_round.png")
drawable = res / "drawable"
drawable.mkdir(parents=True, exist_ok=True)
# il template capacitor ha già ic_launcher_foreground.xml / ic_launcher_background.xml in drawable:
# li rimuoviamo così i nostri PNG non vanno in conflitto (Duplicate resources)
for old in ["ic_launcher_foreground.xml", "ic_launcher_background.xml"]:
    p = drawable / old
    if p.exists():
        p.unlink()
shutil.copy(icons / "ic_launcher_foreground.png", drawable / "ic_launcher_foreground.png")
shutil.copy(icons / "ic_launcher_background.png", drawable / "ic_launcher_background.png")
v26 = res / "mipmap-anydpi-v26"
v26.mkdir(parents=True, exist_ok=True)
adaptive = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '    <background android:drawable="@drawable/ic_launcher_background"/>\n'
    '    <foreground android:drawable="@drawable/ic_launcher_foreground"/>\n'
    '</adaptive-icon>\n'
)
(v26 / "ic_launcher.xml").write_text(adaptive)
(v26 / "ic_launcher_round.xml").write_text(adaptive)

# 2) copia i plugin Java e file_paths.xml
pkg_dir = root / "app/src/main/java/com/tecmat/emanager"
pkg_dir.mkdir(parents=True, exist_ok=True)
shutil.copy(overlay / "UpdateInstallerPlugin.java", pkg_dir / "UpdateInstallerPlugin.java")
shutil.copy(overlay / "LanBeaconPlugin.java", pkg_dir / "LanBeaconPlugin.java")
res_xml = root / "app/src/main/res/xml"
res_xml.mkdir(parents=True, exist_ok=True)
shutil.copy(overlay / "file_paths.xml", res_xml / "file_paths.xml")

# 2b) dipendenze NanoHTTPD (beacon LAN P2P: HTTP /api/info + WebSocket) in app/build.gradle
gradle = root / "app" / "build.gradle"
g = gradle.read_text()
for dep in [
    "implementation 'org.nanohttpd:nanohttpd:2.3.1'",
    "implementation 'org.nanohttpd:nanohttpd-websocket:2.3.1'",
]:
    if dep not in g:
        if "dependencies {" in g:
            g = g.replace("dependencies {", "dependencies {\n    " + dep, 1)
        else:
            g += "\ndependencies {\n    " + dep + "\n}\n"

# 2c) versionName/versionCode = versione dell'app (apps/web/package.json): le impostazioni
# di sistema Android devono mostrare la build corretta (non il default "1.0" del template)
import json as _json
_web_pkg = _json.loads((overlay.parent / "package.json").read_text())
_ver = str(_web_pkg.get("version", "0.1.0"))
try:
    _parts = _ver.split(".")
    _vcode = int(_parts[0]) * 10000 + int(_parts[1]) * 100 + int(_parts[2] if len(_parts) > 2 else 0)
except Exception:
    _vcode = 1
if "versionCode" in g:
    g = re.sub(r"versionCode\s*=?\s*\d+", f"versionCode {_vcode}", g, count=1)
elif "defaultConfig" in g:
    g = re.sub(r"(defaultConfig\s*\{)", r"\1\n        versionCode " + str(_vcode), g, count=1)
if "versionName" in g:
    g = re.sub(r'versionName\s+"[^"]*"', f'versionName "{_ver}"', g, count=1)
elif "defaultConfig" in g:
    g = re.sub(r"(defaultConfig\s*\{)", r'\1\n        versionName "' + _ver + '"', g, count=1)

# 2d) firma DEBUG stabile: keystore committato nell'overlay (apps/web/android-overlay/debug.keystore,
#     chiave pubblica SOLO per sideload, come la debug key di Android). Senza questo ogni runner CI
#     genera una debug key diversa in ~/.android e ogni APK ha firma diversa -> gli update in-app
#     falliscono con INSTALL_FAILED_UPDATE_INCOMPATIBLE ("app non installata" su Samsung/One UI).
shutil.copy(overlay / "debug.keystore", root / "debug.keystore")
if "signingConfigs" not in g:
    debug_block = """
    signingConfigs {
        debug {
            storeFile file('../debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
            storeType 'PKCS12'
        }
    }
"""
    if "android {" in g:
        g = g.replace("android {", "android {" + debug_block, 1)
    else:
        g = "android {" + debug_block + "\n" + g
gradle.write_text(g)

# 2e) SDK 36 (requisito Play Store): compileSdk/targetSdk -> 36, AGP 8.13 (supporta compileSdk 36),
#      Gradle 8.14 (minimo per AGP 8.13), androidx Activity/Core/AppCompat aggiornate per API 36
vg = root / "variables.gradle"
v = vg.read_text()
v = re.sub(r"compileSdkVersion\s*=\s*\d+", "compileSdkVersion = 36", v, count=1)
v = re.sub(r"targetSdkVersion\s*=\s*\d+", "targetSdkVersion = 36", v, count=1)
v = re.sub(r"androidxActivityVersion\s*=\s*'[^']*'", "androidxActivityVersion = '1.10.1'", v, count=1)
v = re.sub(r"androidxCoreVersion\s*=\s*'[^']*'", "androidxCoreVersion = '1.16.0'", v, count=1)
v = re.sub(r"androidxAppCompatVersion\s*=\s*'[^']*'", "androidxAppCompatVersion = '1.7.1'", v, count=1)
vg.write_text(v)

root_build = root / "build.gradle"
b = root_build.read_text()
b = re.sub(r"classpath 'com\.android\.tools\.build:gradle:[^']*'", "classpath 'com.android.tools.build:gradle:8.13.0'", b, count=1)
root_build.write_text(b)

gw = root / "gradle" / "wrapper" / "gradle-wrapper.properties"
w = gw.read_text()
w = re.sub(r"distributionUrl=.*", r"distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.2-bin.zip", w, count=1)
gw.write_text(w)

# 2f) R8 attivo in release: DEX ottimizzato + mapping.txt dentro l'AAB (avvisi Play Console
#     "Nessun file di deoffuscamento" / "Ottimizzazione del codice DEX bassa")
if "minifyEnabled true" not in g:
    g = re.sub(r"minifyEnabled\s+false", "minifyEnabled true", g, count=1)
    g = g.replace("minifyEnabled true", "minifyEnabled true\n            shrinkResources true", 1)
    g = g.replace("getDefaultProguardFile('proguard-android.txt')", "getDefaultProguardFile('proguard-android-optimize.txt')")
    gradle.write_text(g)

# 2g) keep dei plugin custom: il bridge Capacitor usa il simple name della classe come plugin ID,
#      R8 non deve rinominarli (UpdateInstallerPlugin / LanBeaconPlugin sono richiamati via JS)
pr = root / "app" / "proguard-rules.pro"
p = pr.read_text()
if "com.tecmat.emanager" not in p:
    pr.write_text(p + "\n# keep plugin custom (bridge JS -> plugin ID = simple name della classe)\n-keep class com.tecmat.emanager.** { *; }\n")

# 3) registra i plugin in MainActivity
ma = pkg_dir / "MainActivity.java"
t = ma.read_text()
plugins = ["UpdateInstallerPlugin", "LanBeaconPlugin"]
for pl in plugins:
    if pl in t:
        continue  # già patchato (idempotente)
    imp = "import com.tecmat.emanager." + pl + ";"
    if "import com.getcapacitor.BridgeActivity;" in t:
        t = t.replace("import com.getcapacitor.BridgeActivity;",
                      "import com.getcapacitor.BridgeActivity;\n" + imp, 1)
    else:
        t = re.sub(r"(package [^;]+;)", r"\1\n" + imp, t, count=1)
    reg = "registerPlugin(" + pl + ".class);"
    # IMPORTANTE: registerPlugin() va chiamato PRIMA di super.onCreate(): il bridge costruisce
    # PluginHeaders durante super.onCreate, e i plugin custom registrati dopo non sono visibili
    # alla WebView (chiamate "not implemented" -> "plugin mancante").
    # NOTA: il template Capacitor 7 genera MainActivity SENZA onCreate (classe vuota): in quel
    # caso creiamo onCreate noi con registerPlugin PRIMA di super.onCreate (non dopo!).
    if re.search(r"super\.onCreate\(\s*savedInstanceState\s*\)\s*;", t):
        t = re.sub(r"super\.onCreate\(\s*savedInstanceState\s*\)\s*;",
                   "        " + reg + "\n        super.onCreate(savedInstanceState);", t, count=1)
    else:
        t = re.sub(
            r"(public class MainActivity extends BridgeActivity\s*\{)",
            r"\1\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        " + reg + "\n        super.onCreate(savedInstanceState);\n    }",
            t,
            count=1,
        )
ma.write_text(t)

# 3b) verifica: ogni registerPlugin deve stare PRIMA di super.onCreate, altrimenti la build
# viene fermata qui (CI) invece di spedire un APK con i plugin invisibili alla WebView
t = ma.read_text()
i_super = t.find("super.onCreate(")
for m in re.finditer(r"registerPlugin\(", t):
    if i_super == -1 or m.start() > i_super:
        raise SystemExit(
            "ERRORE patch_android: registerPlugin() risulta DOPO super.onCreate() in MainActivity.java: "
            "i plugin custom (UpdateInstaller/LanBeacon) sarebbero invisibili alla WebView"
        )
print("  MainActivity ok: registerPlugin prima di super.onCreate")

print("android patch ok: UpdateInstaller + LanBeacon + icone d20 + FileProvider + cleartext + permessi + deep-link 5elan/5ep2p1/5ecode + version " + _ver)
