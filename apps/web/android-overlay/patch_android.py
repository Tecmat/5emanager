#!/usr/bin/env python3
"""Patch del progetto Android generato da Capacitor (CI): aggiunge il plugin UpdateInstaller
(download + installazione APK in-app), il FileProvider e i permessi necessari.
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
if "REQUEST_INSTALL_PACKAGES" not in s:
    s = re.sub(
        r"(<manifest[^>]*>)",
        r'\1\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />',
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
manifest.write_text(s)

# 2) copia plugin Kotlin e file_paths.xml
pkg_dir = root / "app/src/main/java/com/tecmat/emanager"
pkg_dir.mkdir(parents=True, exist_ok=True)
shutil.copy(overlay / "UpdateInstallerPlugin.kt", pkg_dir / "UpdateInstallerPlugin.kt")
res_xml = root / "app/src/main/res/xml"
res_xml.mkdir(parents=True, exist_ok=True)
shutil.copy(overlay / "file_paths.xml", res_xml / "file_paths.xml")

# 3) registra il plugin in MainActivity
ma = pkg_dir / "MainActivity.java"
t = ma.read_text()
if "UpdateInstallerPlugin" not in t:
    if "import com.getcapacitor.BridgeActivity;" in t:
        t = t.replace(
            "import com.getcapacitor.BridgeActivity;",
            "import com.getcapacitor.BridgeActivity;\nimport com.tecmat.emanager.UpdateInstallerPlugin;",
            1,
        )
    else:
        t = re.sub(r"(package [^;]+;)", r"\1\nimport com.tecmat.emanager.UpdateInstallerPlugin;", t, count=1)
    if "super.onCreate(savedInstanceState);" in t:
        t = t.replace(
            "super.onCreate(savedInstanceState);",
            "super.onCreate(savedInstanceState);\n        registerPlugin(UpdateInstallerPlugin.class);",
            1,
        )
    else:
        # fallback: aggiungi un metodo onCreate se manca
        t = re.sub(
            r"(public class MainActivity extends BridgeActivity \{)",
            r"\1\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        registerPlugin(UpdateInstallerPlugin.class);\n    }",
            t,
            count=1,
        )
    ma.write_text(t)

print("android patch ok: UpdateInstaller + FileProvider + REQUEST_INSTALL_PACKAGES")
