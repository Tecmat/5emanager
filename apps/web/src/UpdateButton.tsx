import { useEffect, useState } from 'react';
import { useStore } from './store.js';
import { installPermissionGranted, openInstallPermissionSettings } from './permissions.js';
import Icon from './icons.js';
import {
  applyAndroidUpdate,
  applyDesktopUpdate,
  applyServerUpdate,
  applyWebUpdate,
  checkSwUpdate,
  checkUpdate,
  detectPlatform,
  downloadDesktopUpdate,
  errMsg,
  REPO,
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
  const [swAvail, setSwAvail] = useState(false);
  const [status, setStatus] = useState<'idle' | 'checking' | 'ready' | 'downloading' | 'error'>('idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [installPerm, setInstallPerm] = useState<boolean | null>(null);
  const platform = detectPlatform();

  // Android: il permesso "installa app sconosciute" serve per installare l'APK dall'app
  useEffect(() => {
    if (platform === 'android') void installPermissionGranted().then(setInstallPerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  const run = async () => {
    setStatus('checking');
    setMsg('');
    setProgress(null);
    setDownloaded(false);
    try {
      const [api, sw] = await Promise.all([checkUpdate(), platform === 'web' ? checkSwUpdate() : Promise.resolve(false)]);
      setSwAvail(sw);
      if (platform === 'android' && api.available && !api.assetUrl) {
        // il pulsante "Scarica e installa" deve esserci SEMPRE quando c'è un update: URL diretto della release
        api.assetUrl = `https://github.com/${REPO}/releases/download/v${api.latest}/app.apk`;
        api.assetName = api.assetName ?? 'app.apk';
      }
      setInfo({ ...api, available: api.available || sw });
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setMsg(`${t('up.errCheck', 'Controllo non riuscito')} — ${errMsg(e)}`);
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
        // la web app servita dal server si aggiorna da sola: POST /api/update/apply + reload
        setStatus('downloading');
        setMsg(t('up.applyingServer', 'Aggiorno il server…'));
        const r = await applyServerUpdate();
        if (r.ok) {
          setMsg(t('up.serverUpdated', "Server aggiornato — ricarico l'app…"));
          await applyWebUpdate();
        } else {
          setMsg(tf('up.serverFail', 'Auto-update del server non riuscito ({e}) — provo a ricaricare la pagina…', { e: r.error ?? '' }));
          setStatus('ready');
          await applyWebUpdate();
        }
      } else if (platform === 'android') {
        // APK scaricato e prompt di installazione aperto direttamente dentro l'app (niente browser/pop-up)
        setStatus('downloading');
        setProgress(null);
        await applyAndroidUpdate(info, setProgress, () =>
          setMsg(t('up.needsPermNow', 'Aperte le Impostazioni: concedi "Installa app sconosciute" a 5e Manager — al ritorno l\'installazione riparte da sola.')));
        setMsg(t('up.apkInstalling', 'APK scaricato: conferma il prompt di installazione di Android.'));
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
      setMsg(errMsg(e));
    }
  };

  const restart = async () => {
    try {
      await applyDesktopUpdate();
    } catch (e) {
      setStatus('error');
      setMsg(errMsg(e));
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
        <Icon name="bell" size={15} />
        {info?.available && <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent2)' }} />}
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 50, width: 320,
            maxHeight: '70vh', overflow: 'auto',
            boxShadow: '0 8px 30px rgba(0,0,0,.45)',
          }}
        >
          <h3 style={{ marginTop: 0 }}><Icon name="bell" size={14} /> {t('up.title', 'Aggiornamenti')}</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            {tf('up.current', 'versione attuale: v{ v } · piattaforma: { p }', { v: info?.current ?? '…', p: platform })}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={run} disabled={busy}>{busy ? t('up.checking', 'Controllo…') : t('up.check', 'Cerca aggiornamenti')}</button>
            {info?.pageUrl && (platform === 'android' ? (
              // su Android niente pop-up/browser: il link della release resta come testo copiabile
              <span className="muted" style={{ fontSize: 11, wordBreak: 'break-all', alignSelf: 'center' }} title={t('up.pageUrlTitle', 'Copia questo link se vuoi aprire la pagina della release a mano')}>
                {info.pageUrl}
              </span>
            ) : (
              <button onClick={() => window.open(info.pageUrl, '_blank')} title={t('up.pageTitle', 'Apri la pagina della release su GitHub')}>
                {t('up.page', '📄 Release')}
              </button>
            ))}
          </div>
          {status === 'ready' && info && (
            <div className={info.available ? 'ok' : 'muted'} style={{ marginTop: 8, fontSize: 13 }}>
              {info.available
                ? tf('up.available', '🎉 Nuova versione v{ latest } disponibile!', { latest: info.latest })
                : tf('up.upToDate', '✅ Sei aggiornato (v{ current })', { current: info.current })}
              {info.available && info.assetName && <div className="muted" style={{ fontSize: 12 }}>{info.assetName}</div>}
              {platform === 'web' && info.available && !swAvail && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {t('up.webHint', 'La web app si aggiorna con il redeploy del server (git pull + npm run build). Subito puoi usare la nuova AppImage/APK dalla release.')}
                </div>
              )}
            </div>
          )}
          {status === 'downloading' && (
            <div style={{ marginTop: 8 }}>
              <div className="xpbar"><div style={{ width: `${pct ?? 0}%` }} /></div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {pct !== null ? `${pct}%` : '…'} {progress ? `(${fmtBytes(progress.received)}${progress.total ? ` / ${fmtBytes(progress.total)}` : ''})` : ''}
              </div>
              {platform === 'android' && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {t('up.androidSettingsHint', 'Se si sono aperte le Impostazioni: concedi "Installa app sconosciute" a 5e Manager — al ritorno il download e l\'installazione ripartono da soli.')}
                </div>
              )}
            </div>
          )}
          {msg && <div className={status === 'error' ? 'error' : 'ok'} style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-line' }}>{msg}</div>}
          {status === 'error' && /404|privat/i.test(msg) && (
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              {t('up.privateHint', 'Sembra che il repo sia privato: sul server imposta GITHUB_TOKEN (vedi docs/UPDATE.md e docs/DEPLOY_DEBIAN.md); sul desktop basta `gh auth login` o la env GITHUB_TOKEN. La web app usa /api/update del server.')}
            </div>
          )}
          {platform === 'android' && info?.available && installPerm === false && (
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              {t('up.installPermHint', 'Per installare l\'APK dentro l\'app serve il permesso speciale "Installa app sconosciute" (una volta sola):')}{' '}
              <button onClick={() => void openInstallPermissionSettings()}>{t('up.enableInstallPerm', '🔓 Abilita ora')}</button>
            </div>
          )}
          {status === 'ready' && info?.available && (
            <div className="row" style={{ marginTop: 8 }}>
              {platform === 'web' && <button className="primary" onClick={apply} disabled={busy}>{t('up.updateNow', '🔄 Aggiorna ora')}</button>}
              {platform === 'android' && <button className="primary" onClick={apply} disabled={busy || !info.assetUrl}>{t('up.downloadInstallApk', '⬇️ Scarica e installa APK')}</button>}
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
