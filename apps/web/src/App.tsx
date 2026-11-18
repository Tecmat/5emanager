import { useEffect, useState } from 'react';
import { totalLevel } from '@dnd5e/core';
import { useStore } from './store.js';
import { useNet, sha256Hex } from './netStore.js';
import CreateForm from './CreateForm.js';
import Overview from './Overview.js';
import SpellsTab from './SpellsTab.js';
import InventoryTab from './InventoryTab.js';
import CustomTab from './CustomTab.js';
import CombatTab from './CombatTab.js';
import CampaignTab from './CampaignTab.js';

type Tab = 'panoramica' | 'incantesimi' | 'inventario' | 'combattimento' | 'campagna' | 'custom';

const LOCK_KEY = 'dnd5e.lock.v1';

interface LockRec {
  enabled: boolean;
  hash: string;
}

function loadLock(): LockRec {
  try {
    const r = JSON.parse(localStorage.getItem(LOCK_KEY) ?? '{}') as Partial<LockRec>;
    return { enabled: !!r.enabled, hash: r.hash ?? '' };
  } catch {
    return { enabled: false, hash: '' };
  }
}

export default function App() {
  const { char, sheets, selectSheet, lang, setLang, t } = useStore();
  const { conn } = useNet();
  const [tab, setTab] = useState<Tab>('panoramica');
  const [theme, setTheme] = useState(localStorage.getItem('dnd5e-theme') ?? 'dark');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lock, setLock] = useState<LockRec>(loadLock);
  const [unlocked, setUnlocked] = useState(() => !loadLock().enabled);
  const [lockPw, setLockPw] = useState('');
  const [lockErr, setLockErr] = useState('');

  useEffect(() => {
    if (char) setCreating(false);
  }, [char]);

  const toggleTheme = () => {
    const t2 = theme === 'dark' ? 'light' : 'dark';
    setTheme(t2);
    localStorage.setItem('dnd5e-theme', t2);
    document.documentElement.dataset.theme = t2;
  };

  const tryUnlock = async () => {
    const hash = await sha256Hex(lockPw);
    if (hash === lock.hash) {
      setUnlocked(true);
      setLockErr('');
      setLockPw('');
    } else {
      setLockErr('Password errata');
    }
  };

  // blocco app con password locale (protegge le schede offline)
  if (lock.enabled && !unlocked) {
    return (
      <main>
        <div className="card" style={{ maxWidth: 360, margin: '80px auto' }}>
          <h3>🔐 App bloccata</h3>
          <div className="muted" style={{ marginBottom: 8 }}>Inserisci la password locale per aprire le tue schede.</div>
          <input
            type="password"
            value={lockPw}
            autoFocus
            onChange={(e) => setLockPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') tryUnlock(); }}
            placeholder="Password locale"
          />
          {lockErr && <div className="error" style={{ marginTop: 6 }}>{lockErr}</div>}
          <div style={{ marginTop: 10 }}>
            <button className="primary" onClick={tryUnlock}>Sblocca</button>
          </div>
        </div>
      </main>
    );
  }

  if (!char || creating) {
    return <CreateForm onCancel={char ? () => setCreating(false) : undefined} />;
  }

  return (
    <>
      <header className="top">
        <span className="row">
          {char.portrait && <img className="portrait" style={{ width: 36, height: 36 }} src={char.portrait} alt={char.name} />}
          <h1>⚔️ D&D 5e — {char.name}</h1>
          {sheets.length > 1 && (
            <select
              value={char.id}
              onChange={(e) => selectSheet(e.target.value)}
              title={t('app.switcher', 'Cambia scheda personaggio')}
              style={{ maxWidth: 180 }}
            >
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>{s.name} (liv {totalLevel(s)})</option>
              ))}
            </select>
          )}
          <button onClick={() => setCreating(true)} title={t('cf.title', 'Crea un nuovo personaggio')}>{t('app.new', '＋ Nuovo')}</button>
          <button
            className={editing ? 'primary' : ''}
            onClick={() => setEditing((v) => !v)}
            title={editing ? 'Chiudi la modalità modifica' : 'Modifica la scheda (campi editabili)'}
          >
            ✏️ {editing ? 'Fatto' : 'Modifica'}
          </button>
        </span>
        <span className="row">
          <span className="muted" title={conn.phase === 'online' ? `Connesso a ${conn.campaign.name} (${conn.campaign.id})` : 'Non connesso a nessuna campagna'}>
            {conn.phase === 'online' ? `🟢 ${conn.campaign.name}` : '⚪ offline'}
          </span>
          <span className="muted">{t('app.sheets', 'Gestore schede')}{sheets.length > 1 ? ` · ${sheets.length} ${t('app.sheetsCount', 'schede')}` : ''}</span>
          <button onClick={() => setLang(lang === 'it' ? 'en' : 'it')} title="IT / EN">🌐 {lang.toUpperCase()}</button>
          <button onClick={toggleTheme} title={t('app.theme', 'Cambia tema')}>{theme === 'dark' ? '🌙' : '☀️'}</button>
        </span>
      </header>
      <main>
        <nav className="tabs">
          {(
            [
              ['panoramica', t('tab.panoramica', 'Panoramica')],
              ['incantesimi', t('tab.incantesimi', 'Incantesimi')],
              ['inventario', t('tab.inventario', 'Inventario')],
              ['combattimento', t('tab.combattimento', '⚔️ Combattimento')],
              ['campagna', t('tab.campagna', '🌐 Campagna')],
              ['custom', t('tab.custom', 'Contenuti custom')],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        {tab === 'panoramica' && <Overview editing={editing} />}
        {tab === 'incantesimi' && <SpellsTab />}
        {tab === 'inventario' && <InventoryTab />}
        {tab === 'combattimento' && <CombatTab />}
        {tab === 'campagna' && <CampaignTab />}
        {tab === 'custom' && <CustomTab />}
      </main>
    </>
  );
}
