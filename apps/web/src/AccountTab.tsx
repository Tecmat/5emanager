import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store.js';
import { useNet, passkeySupported } from './netStore.js';
import { qrEncode, qrSvg } from './qr.js';
import Icon from './icons.js';

/** QR del testo (secret TOTP) */
function QrBox({ text }: { text: string }) {
  const res = useMemo(() => qrEncode(text), [text]);
  if (!res) return <div className="error" style={{ fontSize: 11 }}>QR non generabile (codice troppo lungo)</div>;
  const scale = Math.max(1, Math.floor(160 / (res.size + 8)));
  return (
    <span
      style={{ display: 'inline-block', lineHeight: 0, background: '#fff', borderRadius: 6, padding: 4 }}
      dangerouslySetInnerHTML={{ __html: qrSvg(res, scale) }}
    />
  );
}

/**
 * Tab "Account" dedicata: sessione sul server (login/registrazione/logout), sicurezza
 * (2FA TOTP + passkey) e libreria schede sincronizzata sull'account.
 * Prima viveva dentro la tab Campagna: qui è una pagina a sé, più ordinata.
 */
export default function AccountTab() {
  const { t, tf, char, reg } = useStore();
  const {
    auth, registration, notice,
    doLogin, doRegister, doLoginTotp, doLoginTotpBackup, logout,
    totpPending, totpSetup, setupTotp, enableTotp, disableTotp,
    passkeys, passkeyLogin, passkeyRegister, refreshPasskeys, removePasskey,
    act,
  } = useNet();
  const [accountName, setAccountName] = useState('');
  const [accountPw, setAccountPw] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); fn(); }
  };

  useEffect(() => {
    if (auth && passkeySupported) void refreshPasskeys();
  }, [auth?.username]);

  return (
    <div className="grid">
      <div className="card">
        <h3><Icon name="user" candy size={16} /> {t('cg.account', 'Account')}</h3>
        {auth ? (
          <>
            <div className="ok">{t('cg.loggedAsA', '✅ Loggato come')} <b>{auth.username}</b>{tf('cg.loggedAsB', ' — {n} scheda/e in libreria', { n: auth.characters.length })}</div>
            {registration && (
              <div style={{ marginTop: 4 }}>
                <span className="tag" title={t('home.regTitle', 'Modalità di registrazione del server')}>
                  {registration === 'invite' ? `📨 ${t('home.regInvite', 'solo su invito')}` : registration === 'open' ? `✅ ${t('home.regOpen', 'registrazione aperta')}` : `⏳ ${t('home.regApproval', 'con approvazione')}`}
                </span>
              </div>
            )}
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 8 }}>
              <button onClick={logout}>{t('cg.logout', 'Esci dall\'account')}</button>
              {auth.role === 'admin' && (
                <a
                  className="tag"
                  href="/admin"
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none', padding: '4px 10px', cursor: 'pointer', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  title={t('cg.adminPanelTitle', 'Apri il pannello admin del server in una nuova scheda (da lì torna qui con il link “App”)')}
                >
                  🛡️ {t('cg.adminPanel', 'Pannello admin')}
                </a>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <input value={accountName} onChange={(e) => setAccountName(e.target.value)} onKeyDown={onEnter(() => doLogin(accountName, accountPw))} placeholder="Username" style={{ flex: 1 }} />
              <input type="password" value={accountPw} onChange={(e) => setAccountPw(e.target.value)} onKeyDown={onEnter(() => doLogin(accountName, accountPw))} placeholder={t('cg.pwServer', 'Password (verificata dal server)')} style={{ flex: 1 }} />
            </div>
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 8 }}>
              {registration !== 'invite' && (
                <button onClick={() => doRegister(accountName, accountPw)}>{t('cg.register', 'Registrati')}</button>
              )}
              <button className="primary" onClick={() => doLogin(accountName, accountPw)}>{t('cg.login', 'Login')}</button>
              {passkeySupported && (
                <button onClick={() => void passkeyLogin(accountName)} title={t('cg.pkLoginTitle', 'Accedi con una passkey (impronta/PIN del dispositivo o password manager): niente password')}>
                  🔑 {t('cg.pkLogin', 'Accedi con passkey')}
                </button>
              )}
            </div>
            {!passkeySupported && (
              <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>
                🔑 {t('cg.pkNeedHttps', 'Le passkey funzionano solo su HTTPS (o localhost): configura https sul server per usarle')}
              </div>
            )}
            {accountName.trim() !== '' && passkeySupported && (
              <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>{t('cg.pkLoginAs', 'come')} <b>{accountName.trim()}</b></div>
            )}
            {totpPending && (
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 8 }}>
                <span className="muted">🔐 {t('cg.2faNeed', '2FA attiva su questo account: inserisci il codice dell\'app authenticator')}</span>
                <input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  onKeyDown={onEnter(() => doLoginTotp(totpPending, accountPw, totpCode))}
                  placeholder={t('cg.2faCodePh', 'Codice 6 cifre')}
                  inputMode="numeric"
                  maxLength={6}
                  style={{ width: 130 }}
                  autoFocus
                />
                <button className="primary" disabled={totpCode.trim().length !== 6} onClick={() => doLoginTotp(totpPending, accountPw, totpCode)}>{t('cg.login', 'Login')}</button>
                <button
                  disabled={totpCode.trim().length !== 6}
                  onClick={() => doLoginTotpBackup(totpPending, accountPw, totpCode)}
                  title={t('cg.2faBackupLoginTitle', 'Usa un codice di backup (vale una volta sola)')}
                >
                  {t('cg.2faBackupLogin', 'Usa codice di backup')}
                </button>
              </div>
            )}
            {notice && <div className="ok" style={{ marginTop: 6 }}>ℹ️ {notice}</div>}
            <div className="muted" style={{ marginTop: 6 }}>
              {registration === 'invite'
                ? `📨 ${t('home.regInviteHint', 'Su questo server la registrazione è solo su invito: chiedi all\'admin un link /invite?token=… (univoco, a scadenza, vale una sola volta)')}`
                : t('cg.regNote', 'La registrazione crea una richiesta che l\'admin approva dal pannello /admin; la password è salvata lato server solo come hash (scrypt), mai in chiaro.')}
            </div>
          </>
        )}
      </div>

      {auth && (
        <div className="card">
          <h3><Icon name="lock" candy size={16} /> {t('acc.security', 'Sicurezza (2FA e passkey)')}</h3>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {auth.totpEnabled ? (
              <>
                <span className="ok">🔐 {t('cg.2faOn', '2FA attiva')}</span>
                <button
                  onClick={() => {
                    const pw = window.prompt(t('cg.2faDisablePw', 'Password dell\'account per disattivare la 2FA:'));
                    if (pw) void disableTotp(pw);
                  }}
                >
                  {t('cg.2faOff', 'Disattiva 2FA')}
                </button>
              </>
            ) : (
              <button onClick={() => void setupTotp()} title={t('cg.2faEnableTitle', 'Attiva la verifica in due passaggi con un\'app authenticator (Google Authenticator, Aegis…)')}>
                🔐 {t('cg.2faEnable', 'Attiva 2FA')}
              </button>
            )}
          </div>
          {totpSetup && !auth.totpEnabled && (
            <div style={{ marginTop: 8, padding: 10, background: 'var(--panel2)', borderRadius: 8 }}>
              <b>{t('cg.2faScan', 'Scansiona il QR con l\'app authenticator, poi inserisci il codice a 6 cifre per confermare')}</b>
              <div className="row" style={{ marginTop: 6, alignItems: 'flex-start', gap: 12 }}>
                <QrBox text={totpSetup.otpauthUrl} />
                <div>
                  <div className="muted" style={{ fontSize: 11 }}>{t('cg.2faSecret', 'secret (inserimento manuale):')} <code>{totpSetup.secret}</code></div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t('cg.2faBackup', 'Codici di backup (salvali: valgono una volta sola):')}</div>
                  <div style={{ columns: 2 }}>
                    {totpSetup.backupCodes.map((b) => <div key={b} style={{ fontSize: 12 }}><code>{b}</code></div>)}
                  </div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  onKeyDown={onEnter(() => void enableTotp(totpCode))}
                  placeholder={t('cg.2faCodePh', 'Codice 6 cifre')}
                  inputMode="numeric"
                  maxLength={6}
                  style={{ width: 130 }}
                />
                <button className="primary" disabled={totpCode.trim().length !== 6} onClick={() => void enableTotp(totpCode)}>
                  {t('cg.2faConfirm', 'Conferma e attiva')}
                </button>
              </div>
            </div>
          )}
          {passkeySupported && (
            <div style={{ marginTop: 8 }}>
              <div className="row">
                <b>🔑 {t('cg.pkTitle', 'Passkey')}</b>
                <button onClick={() => void passkeyRegister()} title={t('cg.pkAddTitle', 'Registra una nuova passkey (impronta/PIN del dispositivo o password manager)')}>
                  ➕ {t('cg.pkAdd', 'Aggiungi passkey')}
                </button>
                <button onClick={() => void refreshPasskeys()} title={t('cg.refresh', 'Aggiorna')}>
                  <Icon name="refresh" size={13} />
                </button>
              </div>
              {passkeys.length === 0 ? (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t('cg.pkEmpty', 'Nessuna passkey registrata su questo account')}</div>
              ) : (
                passkeys.map((p) => (
                  <div className="row" key={p.id} style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 12 }}>
                      🔑 {p.name}{' '}
                      <span className="muted">
                        ({p.deviceType ?? '?'}{p.backedUp ? ', sync' : ''} · {p.createdAt.slice(0, 10)})
                      </span>
                    </span>
                    <button className="danger" onClick={() => void removePasskey(p.id)}>{t('cg.pkRemove', 'Rimuovi')}</button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {auth && (
        <div className="card">
          <h3><Icon name="book" candy size={16} /> {t('acc.library', 'Libreria schede (sul server)')}</h3>
          <div className="muted" style={{ fontSize: 13 }}>
            {tf('acc.libraryCount', '{n} scheda/e salvate sull\'account {u} — le ritrovi su ogni dispositivo con lo stesso login.', { n: auth.characters.length, u: auth.username })}
          </div>
          {char && (
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="primary"
                onClick={() => act({ kind: 'saveCharacter', character: char })}
                title={tf('acc.saveCurrentTitle', 'Salva la scheda corrente "{name}" nella libreria dell\'account (sincronizzata col server)', { name: char.name })}
              >
                💾 {tf('acc.saveCurrent', 'Salva "{name}" in libreria', { name: char.name })}
              </button>
            </div>
          )}
          {auth.characters.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {auth.characters.map((c) => (
                <div className="row" key={c.id} style={{ marginTop: 4, fontSize: 13 }}>
                  <span>📄 <b>{c.name}</b> <span className="muted">(liv {reg ? c.classLevels.reduce((s, x) => s + x.level, 0) : '?'})</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
