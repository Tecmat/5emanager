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

// file reali del template Capacitor 7 (android-template.tar.gz)
const VARIABLES_GRADLE = `ext {
    minSdkVersion = 23
    compileSdkVersion = 35
    targetSdkVersion = 35
    androidxActivityVersion = '1.9.2'
    androidxAppCompatVersion = '1.7.0'
    androidxCoreVersion = '1.15.0'
}`;

const ROOT_BUILD_GRADLE = `buildscript {
    dependencies {
        classpath 'com.android.tools.build:gradle:8.7.2'
    }
}
apply from: "variables.gradle"
`;

const WRAPPER_PROPS = `distributionBase=GRADLE_USER_HOME
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-all.zip
`;

const PROGUARD_RULES = `# Add project specific ProGuard rules here.
`;

function makeFakeProject(): string {
  const root = mkdtempSync(join(tmpdir(), '5e-android-'));
  mkdirSync(join(root, 'app/src/main/java/com/tecmat/emanager'), { recursive: true });
  mkdirSync(join(root, 'app/src/main/res'), { recursive: true });
  mkdirSync(join(root, 'gradle/wrapper'), { recursive: true });
  writeFileSync(join(root, 'app/src/main/AndroidManifest.xml'), MANIFEST);
  writeFileSync(join(root, 'app/build.gradle'), BUILD_GRADLE);
  writeFileSync(join(root, 'app/proguard-rules.pro'), PROGUARD_RULES);
  writeFileSync(join(root, 'app/src/main/java/com/tecmat/emanager/MainActivity.java'), MAIN_ACTIVITY);
  writeFileSync(join(root, 'variables.gradle'), VARIABLES_GRADLE);
  writeFileSync(join(root, 'build.gradle'), ROOT_BUILD_GRADLE);
  writeFileSync(join(root, 'gradle/wrapper/gradle-wrapper.properties'), WRAPPER_PROPS);
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

  it('manifest: niente REQUEST_INSTALL_PACKAGES (permission restrittiva Play) né FileProvider; permessi rete + camera presenti', () => {
    const root = makeFakeProject();
    roots.push(root);
    execFileSync('python3', [PATCH_ANDROID, root]);
    const m = readFileSync(join(root, 'app/src/main/AndroidManifest.xml'), 'utf8');
    expect(m).not.toContain('REQUEST_INSTALL_PACKAGES');
    expect(m).not.toContain('FileProvider');
    expect(m).not.toContain('file_paths');
    expect(m).toContain('android.permission.CAMERA');
    expect(m).toContain('android.permission.INTERNET');
    expect(m).toContain('android.permission.ACCESS_NETWORK_STATE');
    expect(m).toContain('android.permission.ACCESS_WIFI_STATE');
    // plugin copiati: AppSettings + LanBeacon (niente UpdateInstaller), niente file_paths.xml
    expect(existsSync(join(root, 'app/src/main/java/com/tecmat/emanager/AppSettingsPlugin.java'))).toBe(true);
    expect(existsSync(join(root, 'app/src/main/java/com/tecmat/emanager/LanBeaconPlugin.java'))).toBe(true);
    expect(existsSync(join(root, 'app/src/main/java/com/tecmat/emanager/UpdateInstallerPlugin.java'))).toBe(false);
    expect(existsSync(join(root, 'app/src/main/res/xml/file_paths.xml'))).toBe(false);
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
    expect(ma).toContain('AppSettingsPlugin');
    expect(ma).not.toContain('UpdateInstallerPlugin');
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
    expect(ma.match(/registerPlugin\(/g)?.length).toBe(2); // AppSettings + LanBeacon, una volta sola
    const v = readFileSync(join(root, 'variables.gradle'), 'utf8');
    expect(v.match(/compileSdkVersion = 36/g)?.length).toBe(1);
  });

  it('porta il progetto a SDK 36 (AGP 8.13 + Gradle 8.14) e attiva R8 in release con keep dei plugin', () => {
    const root = makeFakeProject();
    roots.push(root);
    execFileSync('python3', [PATCH_ANDROID, root]);
    const v = readFileSync(join(root, 'variables.gradle'), 'utf8');
    expect(v).toContain('compileSdkVersion = 36');
    expect(v).toContain('targetSdkVersion = 36');
    expect(v).toContain("androidxActivityVersion = '1.10.1'");
    expect(v).toContain("androidxCoreVersion = '1.16.0'");
    expect(v).toContain("androidxAppCompatVersion = '1.7.1'");
    const b = readFileSync(join(root, 'build.gradle'), 'utf8');
    expect(b).toContain('com.android.tools.build:gradle:8.13.0');
    const w = readFileSync(join(root, 'gradle/wrapper/gradle-wrapper.properties'), 'utf8');
    expect(w).toContain('gradle-8.14.2-bin.zip');
    const g = readFileSync(join(root, 'app/build.gradle'), 'utf8');
    expect(g).toContain('minifyEnabled true');
    expect(g).toContain('shrinkResources true');
    // R8 conservativo: niente proguard-android-optimize (può rompere il bridge a runtime)
    expect(g).toContain("getDefaultProguardFile('proguard-android.txt')");
    expect(g).not.toContain('proguard-android-optimize.txt');
    const p = readFileSync(join(root, 'app/proguard-rules.pro'), 'utf8');
    expect(p).toContain('-keep class com.tecmat.emanager.** { *; }');
    expect(p).toContain('-keep class com.getcapacitor.** { *; }');
    expect(p).toContain('-keep class org.nanohttpd.** { *; }');
    expect(p).toContain('-keepattributes JavascriptInterface');
    expect(p).toContain('@android.webkit.JavascriptInterface <methods>;');
  });

  it('non fallisce su progetto minimo (senza variables.gradle / root build.gradle / wrapper / proguard)', () => {
    const root = mkdtempSync(join(tmpdir(), '5e-android-min-'));
    roots.push(root);
    mkdirSync(join(root, 'app/src/main/java/com/tecmat/emanager'), { recursive: true });
    mkdirSync(join(root, 'app/src/main/res'), { recursive: true });
    writeFileSync(join(root, 'app/src/main/AndroidManifest.xml'), MANIFEST);
    writeFileSync(join(root, 'app/build.gradle'), BUILD_GRADLE);
    writeFileSync(join(root, 'app/src/main/java/com/tecmat/emanager/MainActivity.java'), MAIN_ACTIVITY);
    execFileSync('python3', [PATCH_ANDROID, root]); // non deve lanciare FileNotFoundError
    expect(existsSync(join(root, 'debug.keystore'))).toBe(true);
    const g = readFileSync(join(root, 'app/build.gradle'), 'utf8');
    expect(g).toContain('minifyEnabled true'); // R8 patchato comunque su app/build.gradle
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
