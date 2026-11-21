import { totalLevel, type Character } from '@dnd5e/core';
import { useStore, isCampaignSheetId, campaignSheetId } from './store.js';
import { useNet } from './netStore.js';
import Icon from './icons.js';

/**
 * Menù principale: le schede possedute (locali e di campagna), creazione di una
 * nuova scheda e accesso rapido al multiplayer ("Connetti online").
 */
export default function HomeTab({ onCreate, onOnline, onOpenSheet }: { onCreate: () => void; onOnline: () => void; onOpenSheet: (id: string) => void }) {
  const { sheets, char, campaignMeta, reg, t, tf, importSheets } = useStore();
  const { auth, act } = useNet();

  const local = sheets.filter((s) => !isCampaignSheetId(s.id));
  const campaigns = sheets.filter((s) => isCampaignSheetId(s.id));

  const labelOf = (c: Character) => {
    const cid = c.id.slice('campagna:'.length);
    const meta = campaignMeta[cid];
    return meta ? meta.name : t('app.campaign', 'Campagna');
  };

  const clsOf = (c: Character) =>
    c.classLevels.map((cl) => `${reg.classes.get(cl.classId)?.name ?? cl.classId} ${cl.level}`).join(' / ');

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
          <button className="big-btn" onClick={onOnline}><Icon name="globe" size={16} /> {t('home.connectOnline', 'Connetti online')}</button>
        </div>
      </div>

      {local.length === 0 && campaigns.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}><Icon name="book" size={30} /></div>
          <div className="muted" style={{ maxWidth: 420, margin: '0 auto' }}>
            {t('home.empty', 'Nessuna scheda ancora: creane una con "Nuova scheda", oppure entra in una campagna online con "Connetti online".')}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            <button className="primary big-btn" onClick={onCreate}><Icon name="plus" size={16} /> {t('home.newSheet', 'Nuova scheda')}</button>
            <button className="big-btn" onClick={onOnline}><Icon name="globe" size={16} /> {t('home.connectOnline', 'Connetti online')}</button>
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
