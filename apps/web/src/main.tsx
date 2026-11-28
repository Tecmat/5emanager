import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { StoreProvider } from './store.js';
import { NetProvider } from './netStore.js';
import { initDeepLinks } from './deepLink.js';
import { requestStartupPermissions } from './permissions.js';
import { detectPlatform } from './update.js';
import { applyUISettings, loadUISettings, UI_KEY } from './uiSettings.js';
import '@fontsource-variable/cinzel'; // font display "epico" (OFL), woff2 self-hosted nel bundle
import './styles.css';

/**
 * ErrorBoundary globale: se un componente crasha in render (es. schermo nero su desktop),
 * mostriamo l'errore invece di una pagina vuota — e si può ricaricare. Le schede restano
 * salvate in IndexedDB.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: unknown, info: unknown) {
    console.error('[5emanager] crash catturato:', error, info);
    try { localStorage.setItem('dnd5e.lastError', String(error instanceof Error ? error.stack ?? error.message : error)); } catch { /* ignora */ }
  }
  render() {
    if (this.state.error) {
      return (
        <main style={{ maxWidth: 680, margin: '60px auto', padding: 16 }}>
          <div className="card">
            <h2>⚠️ Errore imprevisto</h2>
            <div className="error" style={{ whiteSpace: 'pre-wrap' }}>{this.state.error}</div>
            <div className="muted" style={{ margin: '10px 0' }}>
              Le schede salvate sono al sicuro (IndexedDB). Se l'errore si ripete, annota il messaggio qui sopra.
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="primary" onClick={() => window.location.reload()}>🔄 Ricarica l'app</button>
              <button
                title="Cancella solo le impostazioni dell'interfaccia (tema/palette/tab) e ricarica: non tocca le schede (sono in IndexedDB)"
                onClick={() => {
                  try { localStorage.removeItem(UI_KEY); localStorage.removeItem('dnd5e-theme'); } catch { /* ignora */ }
                  window.location.href = window.location.pathname; // senza query
                }}
              >
                🧹 Ripristina impostazioni UI
              </button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

// log globale di errori sync/async (visibili in console; lo stack finisce in localStorage via boundary)
window.addEventListener('error', (e) => console.error('[5emanager] window.onerror:', e.message, e.error));
window.addEventListener('unhandledrejection', (e) => console.error('[5emanager] unhandledrejection:', (e as PromiseRejectionEvent).reason));

// Android: deep link dai QR (5ELAN:/5EP2P1: aperti dalla fotocamera di sistema) + permessi all'avvio
void initDeepLinks();
document.documentElement.dataset.platform = detectPlatform();
void requestStartupPermissions();

// recovery: ?resetui=1 cancella SOLO le impostazioni UI (tema/palette/tab) — le schede restano in IndexedDB.
// Utile se dopo un update l'app non mostra le tab (su Windows prima si debíaa cancellare AppData/Local/com.tecmat.5emanager).
try {
  if (new URLSearchParams(window.location.search).has('resetui')) {
    localStorage.removeItem(UI_KEY);
    localStorage.removeItem('dnd5e-theme');
  }
} catch { /* ignora */ }

// applica subito tema/palette/icone/tab salvati (prima del primo render, niente flash)
applyUISettings(loadUISettings());

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <NetProvider>
          <App />
        </NetProvider>
      </StoreProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

