import { useState } from 'react';
import { useStore } from './store.js';
import { useNet, loadAuthServer } from './netStore.js';
import { defaultWsUrl, toWsUrl, isServerWebapp } from './net.js';
import { Capacitor } from '@capacitor/core';
import Icon from './icons.js';

export const SETUP_KEY = 'dnd5e.setup.v1';

export function isSetupDone(): boolean {
  try { return localStorage.getItem(SETUP_KEY) === '1'; } catch { return true; }
}

function isNative(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/**
 * Setup al PRIMO avvio dell'app: impostazioni client (nome, lingua, tema) e connessione
 * al server (URL ws/wss, o "continua in locale" = solo schede locali + P2P sulle app native).
 * Su webapp servita dal server il server di default e' l'origin della pagina (https -> wss).
 */
export default function SetupPage({ onDone }: { onDone: () => void }) {
  const { t, tf, lang, setLang } = useStore();
  const { name, setName, url, setUrl } = useNet();
  const native = isNative();
  const serverWebapp = isServerWebapp();

  const [localName, setLocalName] = useState(name);
  const [localLang, setLocalLang] = useState(lang);
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem('dnd5e-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const [mode, setMode] = useState<'server' | 'local'>(serverWebapp || loadAuthServer() ? 'server' : native ? 'local' : 'server');
  const [serverUrl, setServerUrl] = useState(() => url || loadAuthServer() || (serverWebapp ? defaultWsUrl() : ''));

  const applyTheme = (th: string) => {
    document.documentElement.dataset.theme = th;
    try { localStorage.setItem('dnd5e-theme', th); } catch { /* quota */ }
  };

  const save = () => {
    setName(localName.trim());
    setLang(localLang);
    applyTheme(theme);
    if (mode === 'server') {
      const u = toWsUrl(serverUrl);
      if (u) setUrl(u);
    }
    try { localStorage.setItem(SETUP_KEY, '1'); } catch { /* quota */ }
    onDone();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #14161c)', padding: 16, overflow: 'auto',
    }}>
      <div className="card" style={{ maxWidth: 480, width: '100%' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="swords" size={22} /> 5e Manager</h2>
        <p className="muted">{t('setup.sub', 'Prima configurazione: come ti chiami, che lingua usi e se collegarti a un server.')}</p>

        <label>{t('setup.name', 'Il tuo nome (nei multiplayer)')}</label>
        <input value={localName} onChange={(e) => setLocalName(e.target.value)} placeholder={t('setup.namePh', 'es. Master Luca')} style={{ width: '100%' }} />

        <div className="row" style={{ marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label>{t('setup.lang', 'Lingua')}</label>
            <select value={localLang} onChange={(e) => setLocalLang(e.target.value as 'it' | 'en')} style={{ width: '100%' }}>
              <option value="it">Italiano</option>
              <option value="en">English</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>{t('setup.theme', 'Tema')}</label>
            <select value={theme} onChange={(e) => setThemeState(e.target.value)} style={{ width: '100%' }}>
              <option value="dark">{t('setup.dark', 'Scuro')}</option>
              <option value="light">{t('setup.light', 'Chiaro')}</option>
            </select>
          </div>
        </div>

        <label style={{ marginTop: 14 }}>{t('setup.mode', 'Connessione')}</label>
        <div className="row">
          <button className={mode === 'server' ? 'primary' : ''} onClick={() => setMode('server')}>
            <Icon name="globe" size={13} /> {t('setup.serverMode', 'Server remoto')}
          </button>
          <button className={mode === 'local' ? 'primary' : ''} onClick={() => setMode('local')}>
            <Icon name="offline" size={13} /> {t('setup.localMode', 'Solo locale')}
          </button>
        </div>

        {mode === 'server' && (
          <div style={{ marginTop: 8 }}>
            <label>{t('setup.serverUrl', 'Server (ws://, wss:// o https:// — https diventa wss)')}</label>
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder={serverWebapp ? defaultWsUrl() : 'ws://192.168.1.10:3001 o wss://dnd.tuosito.it'}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
            />
            {serverWebapp && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {tf('setup.serverHint', 'Stai usando la webapp servita da {url}: il server di default è questa pagina (login richiesto se il server lo impone).', { url: location.host })}
              </div>
            )}
            {!serverWebapp && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {t('setup.serverHintAlt', 'Lascia il server di default (questa pagina) oppure indica un server remoto. Su HTTPS usa wss:// (lo converte in automatico).')}
              </div>
            )}
          </div>
        )}
        {mode === 'local' && (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {native
              ? t('setup.localHintNative', 'Niente server: schede salvate solo su questo dispositivo e multiplayer P2P sulla stessa rete WiFi.')
              : t('setup.localHintWeb', 'Niente server: solo schede locali in questo browser (il multiplayer P2P è disponibile sulle app native).')}
          </p>
        )}

        <div className="row" style={{ marginTop: 18 }}>
          <button className="primary big-btn" onClick={save} disabled={mode === 'server' && !toWsUrl(serverUrl)}>
            <Icon name="check" size={15} /> {t('setup.done', 'Inizia')}
          </button>
        </div>
      </div>
    </div>
  );
}
