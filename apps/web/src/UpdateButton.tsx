import { useEffect, useState } from 'react';
import { useStore } from './store.js';
import {
  applyDesktopUpdate,
  applyWebUpdate,
  checkSwUpdate,
  checkUpdate,
  detectPlatform,
  downloadDesktopUpdate,
  openAndroidDownload,
  type DownloadProgress,
  type UpdateInfo,
} from './update.js';

function fmtBytes(n: number): string {
  if (n <= 0) return '';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export default function UpdateButton() {
  const { t, tf } = useStore();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<'idle' | 'checking' | 'ready' | 'downloading' | 'error'>('idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [msg, setMsg] = useState('');
  const platform = detectPlatform();

  const run = async () => {
    setStatus('checking');
    setMsg('');
    setProgress(null);
    setDownloaded(false);
    try {
      const [api, sw] = await Promise.all([checkUpdate(), platform === 'web' ? checkSwUpdate() : Promise.resolve(false)]);
      if (api) {
        setInfo({ ...api, available: api.available || sw });
        setStatus('ready');
      } else {
        setStatus('error');
        setMsg(t('up.errCheck', 'Controllo non riuscito (rete assente o GitHub non raggiungibile)'));
      }
    } catch (e) {
      setStatus('error');
      setMsg((e as Error).message);
    }
  };

  // check automatico all'avvio (una volta per sessione)
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async () => {
    if (!info) return;
    setMsg('');
    try {
      if (platform === 'web') {
        setStatus('downloading');
        setMsg(t('up.applying', 'Applico l\'aggiornamento…'));
        await applyWebUpdate();
      } else if (platform === 'android') {
        await openAndroidDownload(info);
        setMsg(t('up.androidHint', 'APK in download: al termine tocca il file scaricato per installare la nuova versione.'));
        setStatus('ready');
      } else {
        if (!info.assetUrl) {
          setMsg(t('up.noAsset', 'Nessun AppImage in questa release: apri la pagina della release.'));
          window.open(info.pageUrl, '_blank');
          setStatus('ready');
          return;
        }
        setStatus('downloading');
        await downloadDesktopUpdate(info.assetUrl, setProgress);
        setDownloaded(true);
        setMsg(t('up.downloaded', 'Download completato — riavvia per applicare la nuova versione.'));
        setStatus('ready');
      }
    } catch (e) {
      setStatus('error');
      setMsg((e as Error).message);
    }
  };

  const restart = async () => {
    try {
      await applyDesktopUpdate();
    } catch (e) {
      setStatus('error');
      setMsg((e as Error).message);
    }
  };

  const busy = status === 'checking' || status === 'downloading';
  const pct = progress && progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : null;

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('up.title', 'Aggiornamenti dell\'app')}
        aria-label={t('up.title', 'Aggiornamenti dell\'app')}
        style={{ position: 'relative' }}
      >
        🔄
        {info?.available && <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent2)' }} />}
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 50, width: 320,
            boxShadow: '0 8px 30px rgba(0,0,0,.45)',
          }}
        >
          <h3 style={{ marginTop: 0 }}>🔄 {t('up.title', 'Aggiornamenti')}</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            {tf('up.current', 'versione attuale: v{ v } · piattaforma: { p }', { v: info?.current ?? '…', p: platform })}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={run} disabled={busy}>{busy ? t('up.checking', 'Controllo…') : t('up.check', 'Cerca aggiornamenti')}</button>
            {info?.pageUrl && (
              <button onClick={() => window.open(info.pageUrl, '_blank')} title={t('up.pageTitle', 'Apri la pagina della release su GitHub')}>
                {t('up.page', '📄 Release')}
              </button>
            )}
          </div>
          {status === 'ready' && info && (
            <div className={info.available ? 'ok' : 'muted'} style={{ marginTop: 8, fontSize: 13 }}>
              {info.available
                ? tf('up.available', '🎉 Nuova versione v{ latest } disponibile!', { latest: info.latest })
                : tf('up.upToDate', '✅ Sei aggiornato (v{ current })', { current: info.current })}
              {info.available && info.assetName && <div className="muted" style={{ fontSize: 12 }}>{info.assetName}</div>}
            </div>
          )}
          {status === 'downloading' && (
            <div style={{ marginTop: 8 }}>
              <div className="xpbar"><div style={{ width: `${pct ?? 0}%` }} /></div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {pct !== null ? `${pct}%` : '…'} {progress ? `(${fmtBytes(progress.received)}${progress.total ? ` / ${fmtBytes(progress.total)}` : ''})` : ''}
              </div>
            </div>
          )}
          {msg && <div className={status === 'error' ? 'error' : 'ok'} style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-line' }}>{msg}</div>}
          {status === 'ready' && info?.available && (
            <div className="row" style={{ marginTop: 8 }}>
              {platform === 'web' && <button className="primary" onClick={apply}>{t('up.updateNow', '🔄 Aggiorna ora')}</button>}
              {platform === 'android' && <button className="primary" onClick={apply} disabled={!info.assetUrl}>{t('up.downloadApk', '⬇️ Scarica APK')}</button>}
              {platform === 'desktop' && (
                <>
                  <button className="primary" onClick={apply} disabled={busy}>
                    {t('up.downloadInstall', '⬇️ Scarica e installa')}
                  </button>
                  {downloaded && <button className="primary" onClick={restart}>{t('up.restartNow', '▶ Riavvia ora')}</button>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
