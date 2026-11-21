import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { totalLevel } from '@dnd5e/core';
import { useStore, isCampaignSheetId } from './store.js';
import { useNet, sha256Hex } from './netStore.js';
import { hasPendingDeepLink, onDeepLink, queueDeepLink } from './deepLink.js';
import CreateForm from './CreateForm.js';
import UpdateButton from './UpdateButton.js';
import Icon, { type IconName } from './icons.js';

// code-splitting: ogni tab è un chunk separato (P2 performance)
const HomeTab = lazy(() => import('./HomeTab.js'));
const Overview = lazy(() => import('./Overview.js'));
const SpellsTab = lazy(() => import('./SpellsTab.js'));
const InventoryTab = lazy(() => import('./InventoryTab.js'));
const CustomTab = lazy(() => import('./CustomTab.js'));
const CombatTab = lazy(() => import('./CombatTab.js'));
const CampaignTab = lazy(() => import('./CampaignTab.js'));

/** pagine principali del menu: sempre accessibili */
type Page = 'home' | 'campagna' | 'custom' | 'scheda';
/** tab interne alla pagina scheda (visibile solo con una scheda attiva) */
type SheetTab = 'panoramica' | 'incantesimi' | 'inventario' | 'combattimento';
const MAIN_PAGES: { id: Exclude<Page, 'scheda'>; icon: IconName; key: string; fb: string }[] = [
  { id: 'home', icon: 'home', key: 'tab.home', fb: 'Home' },
  { id: 'campagna', icon: 'map', key: 'tab.campagna', fb: 'Campagna' },
  { id: 'custom', icon: 'flask', key: 'tab.custom', fb: 'Contenuti custom' },
];
const SHEET_TABS: { id: SheetTab; icon: IconName; key: string; fb: string }[] = [
  { id: 'panoramica', icon: 'user', key: 'tab.panoramica', fb: 'Panoramica' },
  { id: 'incantesimi', icon: 'wand', key: 'tab.incantesimi', fb: 'Incantesimi' },
  { id: 'inventario', icon: 'bag', key: 'tab.inventario', fb: 'Inventario' },
  { id: 'combattimento', icon: 'swords', key: 'tab.combattimento', fb: 'Combattimento' },
];

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
  const { char, sheets, selectSheet, lang, setLang, t, viewChar, viewLabel, setViewChar, undo, canUndo, campaignMeta } = useStore();
  const { conn } = useNet();
  // page null = auto: pagina scheda se c'è una scheda attiva, altrimenti home
  const [page, setPage] = useState<Page | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTab>('panoramica');
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : localStorage.getItem('dnd5e-theme') ?? 'dark'));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lock, setLock] = useState<LockRec>(loadLock);
  const [unlocked, setUnlocked] = useState(() => !loadLock().enabled);
  const [lockPw, setLockPw] = useState('');
  const [lockErr, setLockErr] = useState('');

  const createdRef = useRef(false);
  // deep link (QR scansionato con la fotocamera di sistema): vai subito alla pagina Campagna
  useEffect(() => {
    if (hasPendingDeepLink()) setPage('campagna');
    return onDeepLink((raw) => {
      queueDeepLink(raw); // CampaignTab lo consuma e instrada
      setPage('campagna');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (creating) createdRef.current = true;
    else if (char && createdRef.current) {
      // dopo la creazione di una scheda si apre direttamente la sua pagina
      createdRef.current = false;
      setPage('scheda');
    }
  }, [creating, char]);

  useEffect(() => {
    if (char) setCreating(false);
  }, [char]);

  // in modalità vista (master che guarda un giocatore) si apre la panoramica;esco dalla campagna -> torno alla mia scheda
  useEffect(() => {
    if (viewChar) {
      setPage('scheda');
      setSheetTab('panoramica');
    }
  }, [viewChar]);

  // pagina effettiva: senza scheda attiva la pagina scheda non esiste -> home
  const effPage: Page = page === 'scheda' && !char ? 'home' : page ?? (char ? 'scheda' : 'home');

  // scorciatoie da tastiera: 1-3 pagine del menu / 1-4 tab della pagina scheda, "e" edit on/off, Ctrl/Cmd+Z annulla
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!typing || true) { e.preventDefault(); undo(); }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key)) {
        const n = Number(e.key);
        if (effPage === 'scheda') {
          if (n <= SHEET_TABS.length) setSheetTab(SHEET_TABS[n - 1].id);
        } else if (n <= MAIN_PAGES.length) {
          setPage(MAIN_PAGES[n - 1].id);
        }
      } else if (e.key.toLowerCase() === 'e' && char && !viewChar) setEditing((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [char, viewChar, undo, effPage]);
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
          <h3><Icon name="lock" size={15} /> {t('app.lockTitle', 'App bloccata')}</h3>
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

  if (creating) {
    return <CreateForm onCancel={char ? () => setCreating(false) : undefined} />;
  }

  return (
    <>
      <header className="top">
        <span className="row">
          {char?.portrait && <img className="portrait" style={{ width: 36, height: 36 }} src={char.portrait} alt={char.name} />}
          <h1><Icon name="swords" size={19} /> D&D 5e{char ? ` — ${char.name}` : ''}</h1>
          {viewChar && (
            <>
              <span className="tag custom"><Icon name="eye" size={12} /> {t('app.viewing', 'stai vedendo la scheda di')} {viewLabel} ({t('app.readonly', 'sola lettura')})</span>
              <button onClick={() => setViewChar(null)} title={t('app.mySheetTitle', 'Torna alla tua scheda')}><Icon name="x" size={13} /> {t('app.mySheet', 'mia scheda')}</button>
            </>
          )}
          {!viewChar && sheets.length > 1 && char && (
            <select
              value={char.id}
              onChange={(e) => { selectSheet(e.target.value); setPage('scheda'); }}
              title={t('app.switcher', 'Cambia scheda: locali e campagne (separate)')}
              style={{ maxWidth: 220 }}
            >
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {isCampaignSheetId(s.id)
                    ? `${campaignMeta[s.id.slice('campagna:'.length)]?.name ?? t('app.campaign', 'Campagna')}: ${s.name} (liv ${totalLevel(s)})`
                    : `${s.name} (liv ${totalLevel(s)})`}
                </option>
              ))}
            </select>
          )}
          {!viewChar && (
            <button onClick={() => setCreating(true)} title={t('cf.title', 'Crea un nuovo personaggio')}><Icon name="plus" size={14} /> {t('app.new', 'Nuovo')}</button>
          )}
          {!viewChar && (
            <button
              className={editing ? 'primary' : ''}
              onClick={() => setEditing((v) => !v)}
              title={editing ? t('app.editDoneTitle', 'Chiudi la modalità modifica') : t('app.editTitle', 'Modifica la scheda (campi editabili)')}
              aria-label={t('app.edit', 'Modifica')}
            >
              <Icon name="pencil" size={14} /> {editing ? t('app.editDone', 'Fatto') : t('app.edit', 'Modifica')}
            </button>
          )}
          {!viewChar && canUndo && (
            <button onClick={undo} title={t('app.undoTitle', "Annulla l'ultima modifica (Ctrl+Z)")} aria-label={t('app.undo', 'Annulla')}>
              <Icon name="undo" size={14} /> {t('app.undo', 'Annulla')}
            </button>
          )}
        </span>
        <span className="row">
          <span className="muted status" title={conn.phase === 'online' ? `Connesso a ${conn.campaign.name} (${conn.campaign.id})` : 'Non connesso a nessuna campagna'}>
            {conn.phase === 'online' ? <><Icon name="wifi" size={13} /> {conn.campaign.name}</> : <><Icon name="offline" size={13} /> {t('app.offline', 'offline')}</>}
          </span>
          <span className="muted">{t('app.sheets', 'Gestore schede')}{sheets.length > 1 ? ` · ${sheets.length} ${t('app.sheetsCount', 'schede')}` : ''}</span>
          <button onClick={() => setLang(lang === 'it' ? 'en' : 'it')} title="IT / EN" aria-label="IT / EN"><Icon name="globe" size={14} /> {lang.toUpperCase()}</button>
          <button onClick={toggleTheme} title={t('app.theme', 'Cambia tema')} aria-label={t('app.theme', 'Cambia tema')}>{theme === 'dark' ? <Icon name="moon" size={14} /> : <Icon name="sun" size={14} />}</button>
          <UpdateButton />
        </span>
      </header>
      <main>
        {viewChar && (
          <div className="card" style={{ marginBottom: 10, borderColor: 'var(--accent2)' }}>
            <Icon name="eye" size={13} /> {t('app.viewBanner1', 'Modalità vista: stai guardando la scheda di')} <b>{viewLabel}</b> {t('app.viewBanner2', 'come master — è sola lettura e si aggiorna in tempo reale. Per modificarla usa il pannello master in Campagna (azioni). Torna alla tua scheda con "mia scheda" in alto.')}
          </div>
        )}
        {effPage === 'scheda' && char ? (
          <>
            <nav className="tabs" aria-label={t('app.sheetTabs', 'Scheda')}>
              <button className="back" onClick={() => setPage('home')} title={t('nav.allSheetsTitle', 'Torna a tutte le schede (Home)')}>
                <Icon name="back" size={15} /> {t('tab.home', 'Home')}
              </button>
              <span className="tab-sep" aria-hidden="true" />
              {SHEET_TABS.map((tb, i) => (
                <button
                  key={tb.id}
                  className={sheetTab === tb.id ? 'active' : ''}
                  onClick={() => setSheetTab(tb.id)}
                  aria-label={`${i + 1} — ${t(tb.key, tb.fb)}`}
                >
                  <Icon name={tb.icon} size={15} /> {t(tb.key, tb.fb)}
                </button>
              ))}
            </nav>
            <Suspense fallback={<div className="muted" style={{ padding: 20 }}>…</div>}>
              {sheetTab === 'panoramica' && <Overview editing={editing} />}
              {sheetTab === 'incantesimi' && <SpellsTab />}
              {sheetTab === 'inventario' && <InventoryTab />}
              {sheetTab === 'combattimento' && <CombatTab />}
            </Suspense>
          </>
        ) : (
          <>
            <nav className="tabs" aria-label={t('app.tabs', 'Menu principale')}>
              {MAIN_PAGES.map((p, i) => (
                <button
                  key={p.id}
                  className={effPage === p.id ? 'active' : ''}
                  onClick={() => setPage(p.id)}
                  aria-label={`${i + 1} — ${t(p.key, p.fb)}`}
                >
                  <Icon name={p.icon} size={15} /> {t(p.key, p.fb)}
                </button>
              ))}
            </nav>
            <Suspense fallback={<div className="muted" style={{ padding: 20 }}>…</div>}>
              {effPage === 'home' && (
                <HomeTab
                  onCreate={() => setCreating(true)}
                  onOnline={() => {
                    // senza schede non ha senso connettersi: proponi di crearne una
                    if (sheets.length === 0) {
                      if (window.confirm(t('home.needSheetOnline', 'Non hai ancora nessuna scheda: vuoi crearne una ora prima di connetterti online?'))) setCreating(true);
                    } else setPage('campagna');
                  }}
                  onOpenSheet={(id) => { selectSheet(id); setPage('scheda'); }}
                />
              )}
              {effPage === 'campagna' && <CampaignTab />}
              {effPage === 'custom' && <CustomTab />}
            </Suspense>
          </>
        )}
      </main>
    </>
  );
}
