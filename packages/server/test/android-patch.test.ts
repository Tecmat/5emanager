import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const OVERLAY = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/web/android-overlay');
const PATCH_ANDROID = join(OVERLAY, 'patch_android.py');
const PATCH_SIGNING = join(OVERLAY, 'patch_signing.py');

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.tecmat.emanager">
    <application android:label="5e Manager" android:theme="@style/AppTheme.NoActionBarLaunch">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

const BUILD_GRADLE = `apply plugin: 'com.android.application'

android {
    namespace "com.tecmat.emanager"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "com.tecmat.emanager"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}

dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
}
`;

const MAIN_ACTIVITY = `package com.tecmat.emanager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
}
`;

function makeFakeProject(): string {
  const root = mkdtempSync(join(tmpdir(), '5e-android-'));
  mkdirSync(join(root, 'app/src/main/java/com/tecmat/emanager'), { recursive: true });
  mkdirSync(join(root, 'app/src/main/res'), { recursive: true });
  writeFileSync(join(root, 'app/src/main/AndroidManifest.xml'), MANIFEST);
  writeFileSync(join(root, 'app/build.gradle'), BUILD_GRADLE);
  writeFileSync(join(root, 'app/src/main/java/com/tecmat/emanager/MainActivity.java'), MAIN_ACTIVITY);
  return root;
}

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('patch_android.py su progetto Capacitor finto', () => {
  it('aggiunge signingConfigs.debug con il keystore committato (firma stabile degli APK CI)', () => {
    const root = makeFakeProject();
    roots.push(root);
    execFileSync('python3', [PATCH_ANDROID, root]);
    const g = readFileSync(join(root, 'app/build.gradle'), 'utf8');
    expect(g).toContain('signingConfigs');
    expect(g).toContain("storeFile file('../debug.keystore')");
    expect(g).toContain("storeType 'PKCS12'");
    expect(existsSync(join(root, 'debug.keystore'))).toBe(true);
    // la chiave committata deve essere un PKCS12 valido (l'output di -info va su stderr)
    const info = spawnSync('openssl', ['pkcs12', '-info', '-in', join(root, 'debug.keystore'), '-passin', 'pass:android', '-noout'], { encoding: 'utf8' });
    expect(info.status).toBe(0);
    expect(info.stderr).toContain('Shrouded Keybag');
  });

  it('registra i plugin PRIMA di super.onCreate e imposta versionName dalla web app', () => {
    const root = makeFakeProject();
    roots.push(root);
    execFileSync('python3', [PATCH_ANDROID, root]);
    const ma = readFileSync(join(root, 'app/src/main/java/com/tecmat/emanager/MainActivity.java'), 'utf8');
    const iSuper = ma.indexOf('super.onCreate(');
    for (const m of ma.matchAll(/registerPlugin\(/g)) {
      expect(m.index! < iSuper).toBe(true);
    }
    expect(ma).toContain('UpdateInstallerPlugin');
    expect(ma).toContain('LanBeaconPlugin');
    const webPkg = JSON.parse(readFileSync(resolve(OVERLAY, '../package.json'), 'utf8'));
    const g = readFileSync(join(root, 'app/build.gradle'), 'utf8');
    expect(g).toContain(`versionName "${webPkg.version}"`);
  });

  it('e idempotente (seconda run non duplica blocchi)', () => {
    const root = makeFakeProject();
    roots.push(root);
    execFileSync('python3', [PATCH_ANDROID, root]);
    execFileSync('python3', [PATCH_ANDROID, root]);
    const g = readFileSync(join(root, 'app/build.gradle'), 'utf8');
    expect(g.match(/signingConfigs/g)?.length).toBe(1);
    expect(g.match(/storeFile file\('\.\.\/debug\.keystore'\)/g)?.length).toBe(1);
    const ma = readFileSync(join(root, 'app/src/main/java/com/tecmat/emanager/MainActivity.java'), 'utf8');
    expect(ma.match(/registerPlugin\(/g)?.length).toBe(2); // UpdateInstaller + LanBeacon, una volta sola
  });
});

describe('patch_signing.py con keystore.jks (secret CI)', () => {
  it('inserisce release dentro signingConfigs esistente e collega buildTypes.release', () => {
    const root = makeFakeProject();
    roots.push(root);
    execFileSync('python3', [PATCH_ANDROID, root]);
    writeFileSync(join(root, 'keystore.jks'), 'dummy');
    execFileSync('python3', [PATCH_SIGNING, root]);
    const g = readFileSync(join(root, 'app/build.gradle'), 'utf8');
    expect(g).toContain("storeFile file('../keystore.jks')");
    expect(g).toContain('signingConfig signingConfigs.release');
    // debug resta presente: stessa firma per debug, release per la store
    expect(g).toContain("storeFile file('../debug.keystore')");
    // idempotente
    execFileSync('python3', [PATCH_SIGNING, root]);
    const g2 = readFileSync(join(root, 'app/build.gradle'), 'utf8');
    expect(g2.match(/keystore\.jks/g)?.length).toBe(1);
  });
});
