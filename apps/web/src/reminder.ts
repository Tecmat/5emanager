/**
 * Promemoria di sessione: salvato in localStorage e mostrato come notifica
 * (Notification API) quando arriva l'ora, anche se l'app è aperta in background
 * (PWA installata). Se l'ora è già passata all'avvio, la notifica parte subito.
 */

export interface Reminder {
  at: string; // ISO datetime-local -> ISO string
  text: string;
  notified?: boolean;
}

const KEY = 'dnd5e.reminder.v1';

export function loadReminder(): Reminder | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Reminder | null;
    return r && r.at ? r : null;
  } catch {
    return null;
  }
}

export function saveReminder(r: Reminder | null): void {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
  } catch { /* quota */ }
}

export function markNotified(): void {
  const r = loadReminder();
  if (r) saveReminder({ ...r, notified: true });
}

/** true se il promemoria è scaduto e non ancora notificato */
export function dueReminder(now = Date.now()): Reminder | null {
  const r = loadReminder();
  if (r && !r.notified && now >= Date.parse(r.at)) return r;
  return null;
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
  }
  return Notification.permission;
}

export function fireNotification(r: Reminder): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification('5e Manager — promemoria di sessione', { body: r.text || 'Sessione di gioco!', tag: 'dnd5e-reminder' });
  } catch { /* ignora */ }
}
