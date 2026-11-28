import { Capacitor } from '@capacitor/core';

/**
 * Permesso Android richiesto ALL'AVVIO: FOTOCAMERA (runtime permission), così la
 * scansione QR funziona senza sorprese (getUserMedia/BarcodeDetector).
 */


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
