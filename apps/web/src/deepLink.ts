import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Deep link nativi (Android): la fotocamera di sistema scansiona il QR dell'host
 * ("5ELAN:ws://ip:porta" o "5EP2P1:...") e, grazie all'intent-filter sugli scheme
 * 5elan/5ep2p1 nel manifest, apre direttamente 5e Manager col link nell'evento
 * appUrlOpen del plugin App (core Capacitor).
 *
 * Gli handler si registrano con onDeepLink(): se l'app parte fredda dal link,
 * l'evento resta in coda (pending) finché un componente non lo consuma.
 */

interface AppPlugin {
  addListener(eventName: 'appUrlOpen', cb: (e: { url: string }) => void): Promise<{ remove: () => Promise<void> }>;
}
const App = registerPlugin<AppPlugin>('App');

type Handler = (raw: string) => void;
const handlers = new Set<Handler>();
const pending: string[] = [];
let started = false;

function emit(raw: string): void {
  if (handlers.size === 0) {
    pending.push(raw);
    return;
  }
  for (const h of [...handlers]) {
    try { h(raw); } catch { /* ignora errori di un handler */ }
  }
}

export function onDeepLink(fn: Handler): () => void {
  handlers.add(fn);
  return () => { handlers.delete(fn); };
}

export function hasPendingDeepLink(): boolean {
  return pending.length > 0;
}

export function consumePendingDeepLink(): string | null {
  return pending.shift() ?? null;
}

/** accoda un link per il prossimo componente che lo consuma (es. CampaignTab appena montato) */
export function queueDeepLink(raw: string): void {
  pending.push(raw);
}

/** installa il listener una sola volta (chiamare all'avvio dell'app) */
export async function initDeepLinks(): Promise<void> {
  if (started || !Capacitor.isNativePlatform()) return;
  started = true;
  try {
    await App.addListener('appUrlOpen', (e) => {
      const raw = String(e?.url ?? '').trim();
      if (raw) emit(raw);
    });
  } catch { /* plugin App non disponibile: niente deep link */ }
}
