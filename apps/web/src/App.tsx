import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { totalLevel } from '@dnd5e/core';
import { useStore, isCampaignSheetId } from './store.js';
import { useNet, sha256Hex } from './netStore.js';
import { hasPendingDeepLink, onDeepLink, queueDeepLink } from './deepLink.js';
import CreateForm from './CreateForm.js';
import Onboarding, { ONBOARD_KEY } from './Onboarding.js';
import SetupPage, { isSetupDone, SETUP_KEY, shouldShowClientSetup } from './SetupPage.js';
import CommandPalette, { type Command } from './CommandPalette.js';
import UpdateButton from './UpdateButton.js';
import Icon from './icons.js';
import { MAIN_PAGES, SHEET_TABS, type Page, type SheetTabId } from './tabs.js';
import { orderTabs, resolvedTheme, updateUISettings, useUISettings } from './uiSettings.js';
import { dueReminder, fireNotification, markNotified, type Reminder } from './reminder.js';
import { requestResume } from './p2pSaved.js';

// code-splitting: ogni tab è un chunk separato (P2 performance)
const HomeTab = lazy(() => import('./HomeTab.js'));
const P2PCampaignsTab = lazy(() => import('./P2PCampaignsTab.js'));
const Overview = lazy(() => import('./Overview.js'));
const SpellsTab = lazy(() => import('./SpellsTab.js'));
const InventoryTab = lazy(() => import('./InventoryTab.js'));
const CustomTab = lazy(() => import('./CustomTab.js'));
const CombatTab = lazy(() => import('./CombatTab.js'));
const CampaignTab = lazy(() => import('./CampaignTab.js'));
const AccountTab = lazy(() => import('./AccountTab.js'));


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
  const { char, sheets, ready, selectSheet, lang, setLang, t, viewChar, viewLabel, setViewChar, undo, canUndo, campaignMeta } = useStore();
  const { conn } = useNet();
  // page null = auto: pagina scheda se c'è una scheda attiva, altrimenti home
  const [page, setPage] = useState<Page | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTabId>('panoramica');
  const ui = useUISettings();
  const effTheme = resolvedTheme(ui);
  // tab effettivamente mostrate (ordine/visibilità personalizzabili dalla Home)
  const visibleMain = useMemo(() => { const v = orderTabs(MAIN_PAGES, ui.mainTabOrder, ui.mainTabHidden); return v.length ? v : [MAIN_PAGES[0]]; }, [ui.mainTabOrder, ui.mainTabHidden]);
  const visibleSheet = useMemo(() => { const v = orderTabs(SHEET_TABS, ui.sheetTabOrder, ui.sheetTabHidden); return v.length ? v : [SHEET_TABS[0]]; }, [ui.sheetTabOrder, ui.sheetTabHidden]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [reminderBanner, setReminderBanner] = useState<Reminder | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lock, setLock] = useState<LockRec>(loadLock);
  const [unlocked, setUnlocked] = useState(() => !loadLock().enabled);
  const [lockPw, setLockPw] = useState('');
  const [lockErr, setLockErr] = useState('');
  const [onboarded, setOnboarded] = useState(() => {
    try { return localStorage.getItem(ONBOARD_KEY) === '1'; } catch { return true; }
  });
  const [setupDone, setSetupDone] = useState(() => isSetupDone());
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  // scorciatoie da tastiera: 1-4 pagine/tab, "e" edit on/off, Ctrl/Cmd+Z annulla, Ctrl/Cmd+K palette comandi
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!typing || true) { e.preventDefault(); undo(); }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key)) {
        const n = Number(e.key);
        if (effPage === 'scheda') {
          if (n <= visibleSheet.length) setSheetTab(visibleSheet[n - 1].id);
        } else if (n <= visibleMain.length) {
          setPage(visibleMain[n - 1].id);
        }
      } else if (e.key.toLowerCase() === 'e' && char && !viewChar) setEditing((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [char, viewChar, undo, effPage, visibleMain, visibleSheet]);

  useEffect(() => {
    if (conn.phase !== 'online' && viewChar) setViewChar(null);
  }, [conn.phase, viewChar, setViewChar]);

  // indicatore di rete (PWA offline: senza rete l'app gira dalla cache)
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  // promemoria di sessione: notifica quando scade (anche all'avvio se era scaduto)
  useEffect(() => {
    const check = () => {
      const r = dueReminder();
      if (r) {
        markNotified();
        fireNotification(r);
        setReminderBanner(r);
      }
    };
    check();
    const iv = setInterval(check, 20000);
    return () => clearInterval(iv);
  }, []);

  const toggleTheme = () => {
    updateUISettings({ theme: effTheme === 'dark' ? 'light' : 'dark' });
  };

  // comandi della palette (Ctrl/Cmd+K)
  const commands: Command[] = [
    ...visibleMain.map((p, i) => ({ id: 'nav-' + p.id, label: t(p.key, p.fb), hint: `${i + 1}`, run: () => setPage(p.id) })),
    ...(char ? [{ id: 'nav-scheda', label: `${t('app.openSheet', 'Scheda')}: ${char.name}`, run: () => setPage('scheda') }] : []),
    { id: 'new', label: `${t('app.new', 'Nuovo')} — ${t('cf.title', 'Nuovo personaggio')}`, run: () => setCreating(true) },
    { id: 'theme', label: t('app.theme', 'Cambia tema'), run: () => toggleTheme() },
    { id: 'lang', label: 'IT / EN', hint: t('app.lang', 'Lingua'), run: () => setLang(lang === 'it' ? 'en' : 'it') },
    ...(canUndo ? [{ id: 'undo', label: t('app.undo', 'Annulla'), hint: '⌘Z', run: () => undo() }] : []),
  ];

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
          <h1><span className="brand-badge"><Icon name="swords" size={16} /></span>D&D 5e{char ? ` — ${char.name}` : ''}</h1>
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
          <span className="muted status" title={conn.phase === 'online' ? `Connesso a ${conn.campaign.name} (${conn.campaign.id})` : conn.phase === 'reconnecting' ? `Disconnesso da ${conn.campaign.name}: riconnessione automatica in corso (tentativo ${conn.attempt})\u2026` : 'Non connesso a nessuna campagna'}>
            {conn.phase === 'online'
              ? <><Icon name="wifi" size={13} /> {conn.campaign.name}</>
              : conn.phase === 'reconnecting'
                ? <><Icon name="offline" size={13} /> {t('app.reconnecting', 'disconnesso, riconnessione\u2026')} ({conn.attempt})</>
                : <><Icon name="offline" size={13} /> {t('app.offline', 'offline')}</>}
          </span>
          <span className="muted">{t('app.sheets', 'Gestore schede')}{sheets.length > 1 ? ` · ${sheets.length} ${t('app.sheetsCount', 'schede')}` : ''}</span>
          <button onClick={() => setLang(lang === 'it' ? 'en' : 'it')} title="IT / EN" aria-label="IT / EN"><Icon name="globe" size={14} /> {lang.toUpperCase()}</button>
          <button onClick={toggleTheme} title={t('app.theme', 'Cambia tema')} aria-label={t('app.theme', 'Cambia tema')}>{effTheme === 'dark' ? <Icon name="moon" size={14} /> : <Icon name="sun" size={14} />}</button>
          {!online && <span className="tag custom" title={t('app.noNet', 'Senza rete: l\'app funziona dalla cache (PWA offline)')}>⚠️ {t('app.noNetShort', 'senza rete')}</span>}
          <button onClick={() => setPaletteOpen(true)} title={t('cmd.open', 'Comandi rapidi (Ctrl+K)')} aria-label={t('cmd.open', 'Comandi rapidi')}>
            <Icon name="search" size={14} /> <span className="kbd">⌘K</span>
          </button>
          <UpdateButton />
        </span>
      </header>
      <main>
        {!ready && (
          <div className="grid" style={{ maxWidth: 860 }} aria-label="caricamento">
            <div className="card"><div className="skeleton skel-line" /><div className="skeleton skel-line short" /></div>
            <div className="cols3 grid">
              {[0, 1, 2].map((i) => <div key={i} className="card"><div className="skeleton skel-box" /></div>)}
            </div>
          </div>
        )}
        {reminderBanner && (
          <div className="card" style={{ marginBottom: 10, borderColor: 'var(--accent)' }}>
            🔔 <b>{reminderBanner.text}</b>
            <span className="muted"> — {new Date(reminderBanner.at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
            <button style={{ marginLeft: 8 }} onClick={() => setReminderBanner(null)}>{t('app.dismiss', 'Ok')}</button>
          </div>
        )}
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
              {visibleSheet.map((tb, i) => (
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
              {visibleMain.map((p, i) => (
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
              {ready && effPage === 'home' && (
                <HomeTab
                  onAccount={() => setPage('account')}
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
              {effPage === 'campagna' && <CampaignTab onGoAccount={() => setPage('account')} />}
              {effPage === 'p2p' && (
                <P2PCampaignsTab
                  onPlay={(id) => {
                    // "Riprendi" dalla tab campagne: torno in Campagna e avvio l'host con quello snapshot
                    requestResume(id);
                    setPage('campagna');
                  }}
                />
              )}
              {effPage === 'custom' && <CustomTab />}
              {effPage === 'account' && <AccountTab />}
            </Suspense>
          </>
        )}
      </main>
      {ready && !creating && sheets.length === 0 && !onboarded && !viewChar && (
        <Onboarding
          onDone={() => setOnboarded(true)}
          onOpenCreate={() => {
            try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* quota */ }
            setOnboarded(true);
            setCreating(true);
          }}
        />
      )}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {shouldShowClientSetup(setupDone) && (
        <SetupPage onDone={() => {
          try { localStorage.setItem(SETUP_KEY, '1'); } catch { /* quota */ }
          setSetupDone(true);
        }} />
      )}
    </>
  );
}
