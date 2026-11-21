import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Permessi Android richiesti ALL'AVVIO, così scansione QR e self-update funzionano
 * senza sorprese:
 *  - FOTOCAMERA (runtime permission): serve a getUserMedia/BarcodeDetector per scansionare;
 *  - "Installa app sconosciute" (permesso speciale, non runtime): serve al plugin
 *    UpdateInstaller per aprire il prompt di installazione dell'APK dentro l'app.
 */

interface UpdateInstallerPlugin {
  hasInstallPermission(): Promise<{ granted: boolean }>;
  openInstallPermissionSettings(): Promise<void>;
  openAppSettings(): Promise<void>;
}
// plugin nativo custom (patchato in CI in apps/web/android-overlay)
const UpdateInstaller = registerPlugin<UpdateInstallerPlugin>('UpdateInstaller');

export function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/** all'avvio (solo Android): chiede il permesso fotocamera una volta, senza bloccare l'UI */
export async function requestStartupPermissions(): Promise<void> {
  if (!isAndroidNative()) return;
  try {
    const { Camera } = await import('@capacitor/camera');
    const p = await Camera.checkPermissions();
    if (p.camera !== 'granted') await Camera.requestPermissions({ permissions: ['camera'] });
  } catch { /* ignora: la scansione QR lo richiederà di nuovo */ }
}

/** true se l'app può installare APK (permesso speciale "installa app sconosciute") */
export async function installPermissionGranted(): Promise<boolean> {
  if (!isAndroidNative()) return true;
  try {
    const r = await UpdateInstaller.hasInstallPermission();
    return !!r?.granted;
  } catch {
    return true; // plugin vecchio senza il metodo: non bloccare il flusso
  }
}

/** apre la schermata di sistema del permesso "installa app sconosciute" per questa app */
export async function openInstallPermissionSettings(): Promise<void> {
  if (!isAndroidNative()) return;
  try {
    await UpdateInstaller.openInstallPermissionSettings();
  } catch {
    try { await UpdateInstaller.openAppSettings(); } catch { /* ignora */ }
  }
}
