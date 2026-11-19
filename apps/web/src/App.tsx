import { lazy, Suspense, useEffect, useState } from 'react';
import { totalLevel } from '@dnd5e/core';
import { useStore } from './store.js';
import { useNet, sha256Hex } from './netStore.js';
import CreateForm from './CreateForm.js';
import UpdateButton from './UpdateButton.js';

// code-splitting: ogni tab è un chunk separato (P2 performance)
const Overview = lazy(() => import('./Overview.js'));
const SpellsTab = lazy(() => import('./SpellsTab.js'));
const InventoryTab = lazy(() => import('./InventoryTab.js'));
const CustomTab = lazy(() => import('./CustomTab.js'));
const CombatTab = lazy(() => import('./CombatTab.js'));
const CampaignTab = lazy(() => import('./CampaignTab.js'));

type Tab = 'panoramica' | 'incantesimi' | 'inventario' | 'combattimento' | 'campagna' | 'custom';
const TAB_ORDER: Tab[] = ['panoramica', 'incantesimi', 'inventario', 'combattimento', 'campagna', 'custom'];

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
  const { char, sheets, selectSheet, lang, setLang, t, viewChar, viewLabel, setViewChar, undo, canUndo } = useStore();
  const { conn } = useNet();
  const [tab, setTab] = useState<Tab>('panoramica');
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : localStorage.getItem('dnd5e-theme') ?? 'dark'));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lock, setLock] = useState<LockRec>(loadLock);
  const [unlocked, setUnlocked] = useState(() => !loadLock().enabled);
  const [lockPw, setLockPw] = useState('');
  const [lockErr, setLockErr] = useState('');

  useEffect(() => {
    if (char) setCreating(false);
  }, [char]);

  // in modalità vista (master che guarda un giocatore) si apre la panoramica;esco dalla campagna -> torno alla mia scheda
  useEffect(() => {
    if (viewChar) setTab('panoramica');
  }, [viewChar]);

  // scorciatoie da tastiera: 1-6 cambiano tab, "e" edit on/off, Ctrl/Cmd+Z annulla
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!typing || true) { e.preventDefault(); undo(); }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[1-6]$/.test(e.key)) setTab(TAB_ORDER[Number(e.key) - 1]);
      else if (e.key.toLowerCase() === 'e' && char && !viewChar) setEditing((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [char, viewChar, undo]);
  useEffect(() => {
    if (conn.phase !== 'online' && viewChar) setViewChar(null);
  }, [conn.phase, viewChar, setViewChar]);

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
      setLockErr(t('app.lockWrong', 'Password errata'));
    }
  };

  // blocco app con password locale (protegge le schede offline)
  if (lock.enabled && !unlocked) {
    return (
      <main>
        <div className="card" style={{ maxWidth: 360, margin: '80px auto' }}>
          <h3>{t('app.lockTitle', '🔐 App bloccata')}</h3>
          <div className="muted" style={{ marginBottom: 8 }}>{t('app.lockDesc', 'Inserisci la password locale per aprire le tue schede.')}</div>
          <input
            type="password"
            value={lockPw}
            autoFocus
            onChange={(e) => setLockPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') tryUnlock(); }}
            placeholder={t('app.lockPh', 'Password locale')}
          />
          {lockErr && <div className="error" style={{ marginTop: 6 }}>{t('app.lockWrong', 'Password errata')}</div>}
          <div style={{ marginTop: 10 }}>
            <button className="primary" onClick={tryUnlock}>{t('app.lockBtn', 'Sblocca')}</button>
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
          {viewChar && (
            <>
              <span className="tag custom">👁 {t('app.viewing', 'stai vedendo la scheda di')} {viewLabel} ({t('app.readonly', 'sola lettura')})</span>
              <button onClick={() => setViewChar(null)} title={t('app.mySheetTitle', 'Torna alla tua scheda')}>{t('app.mySheet', '✕ mia scheda')}</button>
            </>
          )}
          {!viewChar && sheets.length > 1 && (
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
          {!viewChar && (
            <button onClick={() => setCreating(true)} title={t('cf.title', 'Crea un nuovo personaggio')}>{t('app.new', '＋ Nuovo')}</button>
          )}
          {!viewChar && (
            <button
              className={editing ? 'primary' : ''}
              onClick={() => setEditing((v) => !v)}
              title={editing ? t('app.editDoneTitle', 'Chiudi la modalità modifica') : t('app.editTitle', 'Modifica la scheda (campi editabili)')}
              aria-label={t('app.edit', 'Modifica')}
            >
              ✏️ {editing ? t('app.editDone', 'Fatto') : t('app.edit', 'Modifica')}
            </button>
          )}
          {!viewChar && canUndo && (
            <button onClick={undo} title={t('app.undoTitle', "Annulla l'ultima modifica (Ctrl+Z)")} aria-label={t('app.undo', 'Annulla')}>
              ↩ {t('app.undo', 'Annulla')}
            </button>
          )}
        </span>
        <span className="row">
          <span className="muted" title={conn.phase === 'online' ? `Connesso a ${conn.campaign.name} (${conn.campaign.id})` : 'Non connesso a nessuna campagna'}>
            {conn.phase === 'online' ? `🟢 ${conn.campaign.name}` : t('app.offline', '⚪ offline')}
          </span>
          <span className="muted">{t('app.sheets', 'Gestore schede')}{sheets.length > 1 ? ` · ${sheets.length} ${t('app.sheetsCount', 'schede')}` : ''}</span>
          <button onClick={() => setLang(lang === 'it' ? 'en' : 'it')} title="IT / EN" aria-label="IT / EN">🌐 {lang.toUpperCase()}</button>
          <button onClick={toggleTheme} title={t('app.theme', 'Cambia tema')} aria-label={t('app.theme', 'Cambia tema')}>{theme === 'dark' ? '🌙' : '☀️'}</button>
          <UpdateButton />
        </span>
      </header>
      <main>
        {viewChar && (
          <div className="card" style={{ marginBottom: 10, borderColor: 'var(--accent2)' }}>
            {t('app.viewBanner1', '👁 Modalità vista: stai guardando la scheda di')} <b>{viewLabel}</b> {t('app.viewBanner2', 'come master — è sola lettura e si aggiorna in tempo reale. Per modificarla usa il pannello master in 🌐 Campagna (azioni 🔒). Torna alla tua scheda con ✕ in alto.')}
          </div>
        )}
        <nav className="tabs" aria-label={t('app.tabs', 'Schede')}>
          {(
            [
              ['panoramica', t('tab.panoramica', 'Panoramica')],
              ['incantesimi', t('tab.incantesimi', 'Incantesimi')],
              ['inventario', t('tab.inventario', 'Inventario')],
              ['combattimento', t('tab.combattimento', '⚔️ Combattimento')],
              ['campagna', t('tab.campagna', '🌐 Campagna')],
              ['custom', t('tab.custom', 'Contenuti custom')],
            ] as [Tab, string][]
          ).map(([id, label], i) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-label={`${i + 1} — ${label}`}>
              {label}
            </button>
          ))}
        </nav>
        <Suspense fallback={<div className="muted" style={{ padding: 20 }}>…</div>}>
          {tab === 'panoramica' && <Overview editing={editing} />}
          {tab === 'incantesimi' && <SpellsTab />}
          {tab === 'inventario' && <InventoryTab />}
          {tab === 'combattimento' && <CombatTab />}
          {tab === 'campagna' && <CampaignTab />}
          {tab === 'custom' && <CustomTab />}
        </Suspense>
      </main>
    </>
  );
}
