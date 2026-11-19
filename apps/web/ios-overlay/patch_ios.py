#!/usr/bin/env python3
"""Patch del progetto iOS generato da Capacitor (CI): aggiunge NSCameraUsageDescription
(serve a getUserMedia per la scansione QR). Penguin-free, usa plistlib.
Uso: python3 apps/web/ios-overlay/patch_ios.py apps/web/ios
"""
import pathlib
import plistlib
import sys

root = pathlib.Path(sys.argv[1])
plist_path = root / "App" / "App" / "Info.plist"
with open(plist_path, "rb") as f:
    d = plistlib.load(f)
changed = False
for key, desc in {
    "NSCameraUsageDescription": "Serve per scansionare i QR code degli inviti P2P",
    "NSMicrophoneUsageDescription": "Serve solo se usi funzioni vocali (non usata dall'app)",
}.items():
    if key not in d:
        d[key] = desc
        changed = True
if changed or True:
    with open(plist_path, "wb") as f:
        plistlib.dump(d, f)
print("ios Info.plist patch ok")
