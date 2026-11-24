import { isServerWebapp } from './net.js';

export interface ServerMe {
  username: string;
  role: 'admin' | 'user';
  totpEnabled: boolean;
  requireAuth: boolean;
  registration?: string;
}

export type ServerSessionCheck = { kind: 'server'; me: ServerMe } | { kind: 'login' } | { kind: 'skip' };

/**
 * Su webapp servita DAL server (Docker, porta != 5173, non nativa) la sessione vive nel cookie
 * HttpOnly impostato dalla pagina di login del server: qui la controlliamo con /api/me.
 *  - 200            -> l'utente e' gia' loggato (niente form user/password nelle tab home/campagna)
 *  - 401 + requireAuth -> redirect alla pagina di login servita dal server (/login)
 *  - app nativa / dev / offline (PWA dalla cache) -> skip: il login resta facoltativo via WS
 */
export async function checkServerSession(): Promise<ServerSessionCheck> {
  if (!isServerWebapp()) return { kind: 'skip' };
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (r.ok) return { kind: 'server', me: (await r.json()) as ServerMe };
    if (r.status === 401) {
      const j = (await r.json().catch(() => ({}))) as Partial<ServerMe>;
      if (j.requireAuth) return { kind: 'login' };
    }
    return { kind: 'skip' };
  } catch {
    return { kind: 'skip' };
  }
}
