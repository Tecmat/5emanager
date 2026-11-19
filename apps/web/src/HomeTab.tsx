import { totalLevel, type Character } from '@dnd5e/core';
import { useStore, isCampaignSheetId, campaignSheetId } from './store.js';

/**
 * Menù principale: le schede possedute (locali e di campagna), creazione di una
 * nuova scheda e accesso rapido al multiplayer ("Connetti online").
 */
export default function HomeTab({ onCreate, onOnline }: { onCreate: () => void; onOnline: () => void }) {
  const { sheets, selectSheet, char, campaignMeta, reg, t, tf } = useStore();

  const local = sheets.filter((s) => !isCampaignSheetId(s.id));
  const campaigns = sheets.filter((s) => isCampaignSheetId(s.id));

  const labelOf = (c: Character) => {
    const cid = c.id.slice('campagna:'.length);
    const meta = campaignMeta[cid];
    return meta ? `🗺 ${meta.name}` : '🗺 Campagna';
  };

  const clsOf = (c: Character) =>
    c.classLevels.map((cl) => `${reg.classes.get(cl.classId)?.name ?? cl.classId} ${cl.level}`).join(' / ');

  const Card = ({ c, campaign }: { c: Character; campaign?: boolean }) => (
    <button
      key={c.id}
      className="card sheet-card"
      onClick={() => selectSheet(c.id)}
      title={campaign ? labelOf(c) : t('home.openSheet', 'Apri questa scheda')}
      style={{ textAlign: 'left', cursor: 'pointer', borderColor: c.id === char?.id ? 'var(--accent)' : undefined }}
    >
      <span className="row" style={{ alignItems: 'flex-start' }}>
        {c.portrait
          ? <img className="portrait" style={{ width: 56, height: 56 }} src={c.portrait} alt={c.name} />
          : <span className="portrait-ph" style={{ width: 56, height: 56 }}>🧙</span>}
        <span style={{ flex: 1 }}>
          <b style={{ fontSize: 15 }}>{c.name}</b>
          {campaign && <div className="muted" style={{ fontSize: 11 }}>{labelOf(c)}</div>}
          <div className="muted" style={{ fontSize: 12 }}>
            {reg.races.get(c.raceId)?.name ?? c.raceId} · {clsOf(c)} · {t('home.liv', 'liv')} {totalLevel(c)}
          </div>
        </span>
        {c.id === char?.id && <span className="tag custom">✓ {t('home.active', 'attiva')}</span>}
      </span>
    </button>
  );

  return (
    <div className="grid" style={{ maxWidth: 860 }}>
      <div className="card home-hero">
        <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>⚔️ 5e Manager</h2>
        <div className="muted">
          {tf('home.sub', 'Le tue schede: {n} locali, {m} di campagna', { n: local.length, m: campaigns.length })}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary big-btn" onClick={onCreate}>➕ {t('home.newSheet', 'Nuova scheda')}</button>
          <button className="big-btn" onClick={onOnline}>🌐 {t('home.connectOnline', 'Connetti online')}</button>
        </div>
      </div>

      {local.length === 0 && campaigns.length === 0 && (
        <div className="card muted" style={{ textAlign: 'center', padding: 24 }}>
          {t('home.empty', 'Nessuna scheda ancora: creane una con ➕ Nuova scheda, oppure entra in una campagna online con 🌐 Connetti online.')}
        </div>
      )}

      {local.length > 0 && (
        <>
          <h3 className="home-h">{t('home.localSheets', '📚 Schede locali')}</h3>
          <div className="cols3 grid">
            {local.map((c) => <Card key={c.id} c={c} />)}
          </div>
        </>
      )}

      {campaigns.length > 0 && (
        <>
          <h3 className="home-h">{t('home.campaignSheets', '🗺 Schede di campagna (separate da quelle locali)')}</h3>
          <div className="cols3 grid">
            {campaigns.map((c) => <Card key={c.id} c={c} campaign />)}
          </div>
        </>
      )}
    </div>
  );
}

export { campaignSheetId };
