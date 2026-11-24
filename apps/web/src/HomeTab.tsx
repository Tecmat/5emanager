import { useRef, useState } from 'react';
import { totalLevel, uid, type Character } from '@dnd5e/core';
import { PREGEN_DATA } from '@dnd5e/data-srd';
import { useStore, isCampaignSheetId, campaignSheetId } from './store.js';
import { useNet, loadAuthServer, passkeySupported } from './netStore.js';
import { defaultWsUrl, toWsUrl, httpUrlFromWs } from './net.js';
import AppearanceCard from './AppearanceCard.js';
import ReminderCard from './ReminderCard.js';
import { parseDdbJson } from './ddbImport.js';
import Icon from './icons.js';

/**
 * Menù principale: le schede possedute (locali e di campagna), creazione di una
 * nuova scheda e accesso rapido al multiplayer ("Connetti online").
 */
export default function HomeTab({ onCreate, onOnline, onOpenSheet }: { onCreate: () => void; onOnline: () => void; onOpenSheet: (id: string) => void }) {
  const { sheets, char, campaignMeta, reg, t, tf, importSheets, createSheet } = useStore();
  const ddbFileRef = useRef<HTMLInputElement>(null);
  const { auth, act, conn, url, setUrl, servers, doLogin, doRegister, doLoginToken, savedSession, logout, totpPending, doLoginTotp, doLoginTotpBackup, passkeyLogin, error, setError } = useNet();

  const local = sheets.filter((s) => !isCampaignSheetId(s.id));
  const campaigns = sheets.filter((s) => isCampaignSheetId(s.id));
  // già dentro una campagna: il pulsante "Connetti online" non serve
  const connected = conn.phase === 'online' || conn.phase === 'reconnecting';

  const labelOf = (c: Character) => {
    const cid = c.id.slice('campagna:'.length);
    const meta = campaignMeta[cid];
    return meta ? meta.name : t('app.campaign', 'Campagna');
  };

  const clsOf = (c: Character) =>
    c.classLevels.map((cl) => `${reg.classes.get(cl.classId)?.name ?? cl.classId} ${cl.level}`).join(' / ');

  const clonePregen = (p: Character) => {
    const now = new Date().toISOString();
    const clone: Character = { ...structuredClone(p), id: uid('scheda'), createdAt: now, updatedAt: now };
    createSheet(clone);
    onOpenSheet(clone.id);
  };

  /** importa un export JSON di D&D Beyond (solo dati propri) come nuova scheda */
  const importDdb = async (file: File) => {
    const text = await file.text();
    const res = parseDdbJson(text, reg);
    if (!res.character) {
      alert(res.errors.join('\n') || t('home.ddbBad', 'File non riconosciuto come export D&D Beyond'));
      return;
    }
    createSheet(res.character);
    onOpenSheet(res.character.id);
    const msgs = [...res.warnings, ...res.errors].filter(Boolean);
    if (msgs.length) alert(tf('home.ddbWarn', 'Importato "{name}" con avvisi:\n{m}', { name: res.character.name, m: msgs.join('\n') }));
  };

  const Card = ({ c, campaign }: { c: Character; campaign?: boolean }) => (
    <button
      key={c.id}
      className="card sheet-card"
      onClick={() => onOpenSheet(c.id)}
      title={campaign ? labelOf(c) : t('home.openSheet', 'Apri questa scheda')}
      style={{ textAlign: 'left', cursor: 'pointer', borderColor: c.id === char?.id ? 'var(--accent)' : undefined }}
    >
      <span className="row" style={{ alignItems: 'flex-start' }}>
        {c.portrait
          ? <img className="portrait" style={{ width: 56, height: 56 }} src={c.portrait} alt={c.name} />
          : <span className="portrait-ph" style={{ width: 56, height: 56 }}><Icon name="user" size={26} /></span>}
        <span style={{ flex: 1 }}>
          <b style={{ fontSize: 15 }}>{c.name}</b>
          {campaign && <div className="muted" style={{ fontSize: 11 }}>{labelOf(c)}</div>}
          <div className="muted" style={{ fontSize: 12 }}>
            {reg.races.get(c.raceId)?.name ?? c.raceId} · {clsOf(c)} · {t('home.liv', 'liv')} {totalLevel(c)}
          </div>
        </span>
        {c.id === char?.id && <span className="tag custom"><Icon name="check" size={11} /> {t('home.active', 'attiva')}</span>}
      </span>
    </button>
  );

  return (
    <div className="grid" style={{ maxWidth: 860 }}>
      <div className="card home-hero">
        <h2 className="home-title"><Icon name="swords" size={24} /> 5e Manager</h2>
        <div className="muted">
          {tf('home.sub', 'Le tue schede: {n} locali, {m} di campagna', { n: local.length, m: campaigns.length })}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary big-btn" onClick={onCreate}><Icon name="plus" size={16} /> {t('home.newSheet', 'Nuova scheda')}</button>
          {connected
            ? <button className="primary big-btn" onClick={onOnline} title={t('home.goCampaignTitle', 'Sei già dentro una campagna: apri la tab Campagna')}><Icon name="map" size={16} /> {t('home.goCampaignShort', 'Vai a Campagna')}</button>
            : <button className="big-btn" onClick={onOnline}><Icon name="globe" size={16} /> {t('home.connectOnline', 'Connetti online')}</button>}
          <button className="big-btn" onClick={() => ddbFileRef.current?.click()} title={t('home.ddbTitle', 'Importa un export JSON di D&D Beyond (solo i tuoi dati) come nuova scheda')}>
            <Icon name="save" size={16} /> {t('home.ddb', 'Importa da D&D Beyond')}
          </button>
          <input
            ref={ddbFileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importDdb(f); e.target.value = ''; }}
          />
        </div>
      </div>

      <ServerAccountCard
        url={url} setUrl={setUrl} servers={servers} auth={auth} savedSession={savedSession}
        doLogin={doLogin} doRegister={doRegister} doLoginToken={doLoginToken} logout={logout}
        totpPending={totpPending} doLoginTotp={doLoginTotp} doLoginTotpBackup={doLoginTotpBackup}
        passkeyLogin={passkeyLogin} passkeySupported={passkeySupported} error={error} setError={setError}
        onOnline={onOnline} t={t} tf={tf}
      />

      {local.length === 0 && campaigns.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}><Icon name="book" size={30} /></div>
          <div className="muted" style={{ maxWidth: 420, margin: '0 auto' }}>
            {t('home.empty', 'Nessuna scheda ancora: creane una con "Nuova scheda", oppure entra in una campagna online con "Connetti online".')}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            <button className="primary big-btn" onClick={onCreate}><Icon name="plus" size={16} /> {t('home.newSheet', 'Nuova scheda')}</button>
            {connected
              ? <button className="primary big-btn" onClick={onOnline}><Icon name="map" size={16} /> {t('home.goCampaignShort', 'Vai a Campagna')}</button>
              : <button className="big-btn" onClick={onOnline}><Icon name="globe" size={16} /> {t('home.connectOnline', 'Connetti online')}</button>}
          </div>
        </div>
      )}

      {local.length > 0 && (
        <>
          <h3 className="home-h"><Icon name="book" size={15} /> {t('home.localSheets', 'Schede locali')}</h3>
          <div className="cols3 grid">
            {local.map((c) => <Card key={c.id} c={c} />)}
          </div>
        </>
      )}

      {campaigns.length > 0 && (
        <>
          <h3 className="home-h"><Icon name="map" size={15} /> {t('home.campaignSheets', 'Schede di campagna (separate da quelle locali)')}</h3>
          <div className="cols3 grid">
            {campaigns.map((c) => <Card key={c.id} c={c} campaign />)}
          </div>
        </>
      )}

      <div className="card">
        <h3 className="home-h"><Icon name="dice" size={15} /> {t('home.pregenTitle', 'Schede pronte (pregen)')}</h3>
        <div className="muted" style={{ marginBottom: 8 }}>{t('home.pregenHint', 'Personaggi già pronti da clonare come nuove schede locali.')}</div>
        {PREGEN_DATA.map((p) => (
          <div key={p.id} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span>
              <b>{p.name}</b>
              <span className="muted"> — {reg.races.get(p.raceId)?.name ?? p.raceId} · {clsOf(p)} · {t('home.liv', 'liv')} {totalLevel(p)}</span>
            </span>
            <button className="primary" onClick={() => clonePregen(p)} title={tf('home.pregenCloneTitle', 'Clona "{name}" come nuova scheda locale e aprila', { name: p.name })}>
              <Icon name="plus" size={13} /> {t('home.pregenClone', 'Clona')}
            </button>
          </div>
        ))}
      </div>

      <AppearanceCard />
      <ReminderCard />

      <div className="card">
        <h3 className="home-h"><Icon name="globe" candy size={15} /> {auth ? tf('home.remoteTitle', '☁️ Libreria remoto — account {u} ({n} schede)', { u: auth.username, n: auth.characters.length }) : t('home.remoteTitleNoAuth', '☁️ Libreria schede sul server')}</h3>
        {!auth ? (
          <div className="muted">{t('home.remoteHint', 'Login dall\'account (tab 🗺️ Campagna → Server → Account) per sincronizzare le schede sul server e ritrovarle su altri dispositivi.')}</div>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 8 }}>
              <button disabled={!local.length} onClick={() => { for (const c of local) act({ kind: 'saveCharacter', character: c }); }} title={t('home.remoteSaveAllTitle', 'Carica tutte le schede locali sulla libreria dell\'account')}>
                {t('home.remoteSaveAll', '💾 Salva tutte le locali sull\'account')}
              </button>
              <button disabled={!auth.characters.length} onClick={() => importSheets(auth.characters)} title={t('home.remoteDownloadAllTitle', 'Scarica tutta la libreria remoto in locale (merge per id)')}>
                {t('home.remoteDownloadAll', '⬇️ Scarica tutta la libreria in locale')}
              </button>
            </div>
            {auth.characters.length === 0 ? (
              <div className="muted">{t('home.remoteEmpty', 'Nessuna scheda sull\'account: salvane una dalla campagna (💾 Salva nella libreria) o premi "Salva tutte le locali".')}</div>
            ) : (
              auth.characters.map((c) => (
                <div key={c.id} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span><b>{c.name}</b> <span className="muted">(liv {totalLevel(c)})</span></span>
                  <span className="row">
                    <button onClick={() => importSheets([c])} title={t('home.remoteDownloadTitle', 'Importa questa scheda in locale')}>{t('home.remoteDownload', '⬇️ locale')}</button>
                    <button
                      className="danger"
                      aria-label={t('home.remoteDelete', 'Elimina dall\'account')}
                      title={t('home.remoteDelete', 'Elimina dall\'account')}
                      onClick={() => { if (window.confirm(tf('home.remoteDeleteConfirm', 'Eliminare "{name}" dalla libreria dell\'account?', { name: c.name }))) act({ kind: 'deleteCharacter', characterId: c.id }); }}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </span>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { campaignSheetId };


/** card "Server e account": scelta del server ws/wss + login (con mantieni l'accesso) + link account/admin */
function ServerAccountCard(props: {
  url: string; setUrl: (u: string) => void; servers: string[]; auth: ReturnType<typeof useNet>['auth'];
  savedSession: ReturnType<typeof useNet>['savedSession'];
  doLogin: (u: string, p: string, remember?: boolean) => Promise<void>;
  doRegister: (u: string, p: string) => Promise<void>;
  doLoginToken: (token: string) => Promise<void>;
  logout: () => void;
  totpPending: string | null;
  doLoginTotp: (u: string, p: string, c: string, remember?: boolean) => Promise<void>;
  doLoginTotpBackup: (u: string, p: string, b: string, remember?: boolean) => Promise<void>;
  passkeyLogin: (u?: string) => Promise<void>;
  passkeySupported: boolean;
  error: string; setError: (e: string) => void;
  onOnline: () => void;
  t: (k: string, f?: string) => string; tf: (k: string, f: string, v: Record<string, string | number>) => string;
}) {
  const { url, setUrl, servers, auth, savedSession, doLogin, doRegister, doLoginToken, logout, totpPending, doLoginTotp, doLoginTotpBackup, passkeyLogin, passkeySupported, error, setError, onOnline, t, tf } = props;
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState('');
  const [customUrl, setCustomUrl] = useState('');

  const serverOptions = [...new Set([url, loadAuthServer(), ...servers].filter(Boolean))];
  const adminUrl = auth ? httpUrlFromWs(auth.server) + '/admin' : '';

  return (
    <div className="card">
      <h3 className="home-h"><Icon name="globe" candy size={15} /> {t('home.serverTitle', 'Server e account')}</h3>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <select
          value={serverOptions.includes(url) ? url : '__custom'}
          onChange={(e) => {
            if (e.target.value === '__custom') return;
            setUrl(e.target.value);
            setError('');
          }}
          title={t('home.serverPick', 'Scegli il server (ws/wss). https:// viene convertito in wss://')}
          style={{ minWidth: 220 }}
        >
          {serverOptions.map((s2) => <option key={s2} value={s2}>{s2}</option>)}
          {!serverOptions.includes(url) && url && <option value={url}>{url}</option>}
          <option value="__custom">{t('home.serverCustom', '— altro server…')}</option>
        </select>
        <input
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && customUrl.trim()) { setUrl(toWsUrl(customUrl)); setCustomUrl(''); } }}
          placeholder={t('home.serverPh', 'ws://192.168.1.10:3001 oppure https://dnd.tuo.it (→ wss://)')}
          style={{ flex: 1, minWidth: 240, fontFamily: 'monospace', fontSize: 13 }}
        />
        <button onClick={() => { setUrl(toWsUrl(customUrl)); setCustomUrl(''); }} disabled={!customUrl.trim()} title={t('home.serverUse', 'Usa questo server (https:// → wss:// automatico)')}>
          {t('home.serverUseBtn', 'Usa server')}
        </button>
        <button onClick={() => { setUrl(defaultWsUrl()); setError(''); }} title={t('home.serverOrigin', 'Usa il server che sta servendo questa pagina')}>
          {t('home.serverOriginBtn', 'Questa pagina')}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {tf('home.serverCurrent', 'Server attuale: {url}', { url: url || '—' })}
      </div>

      {auth ? (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="tag custom"><Icon name="user" size={11} /> {auth.username}</span>
            <span className="tag">{auth.role === 'admin' ? '🛡️ admin' : t('home.roleUser', 'user')}</span>
            <span className="tag">{tf('home.sheetsRemote', '{n} schede in libreria', { n: auth.characters.length })}</span>
            {savedSession && <span className="tag" title={t('home.keepAliveOn', "'Mantieni l\'accesso' attivo: al prossimo avvio entri da solo")}>🔑 {t('home.keepAlive', 'accesso mantenuto')}</span>}
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
            <button className="primary" onClick={onOnline}><Icon name="map" size={13} /> {t('home.goCampaign', 'Vai a Campagna (usa questo server)')}</button>
            <button onClick={() => { onOnline(); }} title={t('home.myAccountTitle', 'La tua pagina account (libreria, 2FA, passkey) è nella tab Campagna → Account')}>
              <Icon name="user" size={13} /> {t('home.myAccount', 'Il mio account')}
            </button>
            {auth.role === 'admin' && (
              <button onClick={() => window.open(adminUrl, '_blank')} title={t('home.adminTitle', 'Apri il pannello admin del server in una nuova scheda (solo admin)')}>
                🛡️ {t('home.adminPanel', 'Pannello admin')}
              </button>
            )}
            <button className="danger" onClick={logout}>{t('home.logout', 'Esci')}</button>
          </div>
          {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {savedSession && (
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 13 }}>🔑 {tf('home.sessionSaved', 'Sessione salvata per {u} su {s}: provo il login automatico…', { u: savedSession.username, s: savedSession.server })}</span>
              <button onClick={() => doLoginToken(savedSession.token)}>{t('home.retryLogin', 'Riprova login')}</button>
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input value={u} onChange={(e) => setU(e.target.value)} placeholder="Username" autoComplete="username" style={{ flex: 1, minWidth: 130 }} />
            <input
              type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder={t('cg.pwServer', 'Password')}
              autoComplete="current-password" style={{ flex: 1, minWidth: 130 }}
              onKeyDown={(e) => { if (e.key === 'Enter') void doLogin(u, p, remember); }}
            />
            <label className="row" style={{ gap: 5, fontSize: 13, color: 'var(--muted)' }} title={t('home.rememberTitle', 'Salva un token sicuro in questo dispositivo: al prossimo avvio entri senza password')}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('home.remember', 'Mantieni l\'accesso')}
            </label>
          </div>
          {totpPending && (
            <div className="row" style={{ marginTop: 8 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('home.totpPh', 'Codice 2FA (6 cifre)')} inputMode="numeric" maxLength={8} style={{ width: 140 }} />
              <button className="primary" disabled={code.trim().length < 6} onClick={() => void doLoginTotp(totpPending, p, code, remember)}>{t('cg.login', 'Login')}</button>
              <button onClick={() => void doLoginTotpBackup(totpPending, p, code, remember)} title={t('home.backupTitle', 'Usa un codice di backup (monouso)')}>{t('home.backup', 'Codice backup')}</button>
            </div>
          )}
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
            {!totpPending && (
              <>
                <button className="primary" onClick={() => void doLogin(u, p, remember)} disabled={!u.trim() || !p}>{t('cg.login', 'Login')}</button>
                <button onClick={() => void doRegister(u, p)} disabled={!u.trim() || !p}>{t('cg.register', 'Registrati')}</button>
                {passkeySupported && (
                  <button onClick={() => void passkeyLogin(u || undefined)} title={t('cg.pkLoginTitle', 'Accedi con passkey (niente password)')}>
                    🔑 {t('home.passkey', 'Passkey')}
                  </button>
                )}
              </>
            )}
          </div>
          {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
