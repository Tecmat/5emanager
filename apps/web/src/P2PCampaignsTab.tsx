import { useEffect, useState } from 'react';
import { useStore } from './store.js';
import { useNet } from './netStore.js';
import {
  listSavedP2P,
  deleteSavedP2P,
  renameSavedP2P,
  importSavedP2P,
  type SavedP2PCampaign,
} from './p2pSaved.js';
import Icon from './icons.js';

/**
 * Tab dedicata "💾 Campagne P2P": gestione degli snapshot salvati in locale dall'host
 * (riprendi / rinomina / elimina con conferma / sync sull'account del server remoto).
 */
export default function P2PCampaignsTab({ onPlay }: { onPlay: (id: string) => void }) {
  const { t, tf } = useStore();
  const { auth, act, setError } = useNet();
  const [saved, setSaved] = useState<SavedP2PCampaign[]>([]);

  useEffect(() => {
    void listSavedP2P().then(setSaved);
  }, []);

  const reload = () => void listSavedP2P().then(setSaved);

  const remove = (s: SavedP2PCampaign) => {
    if (!window.confirm(tf('p2p.delConfirm', 'Eliminare la campagna "{name}" salvata in locale? L\'azione non si può annullare.', { name: s.name }))) return;
    void deleteSavedP2P(s.id).then(reload);
  };

  const rename = (s: SavedP2PCampaign) => {
    const name = window.prompt(t('p2p.renamePrompt', 'Nuovo nome della campagna:'), s.name);
    if (!name || !name.trim() || name.trim() === s.name) return;
    void renameSavedP2P(s.id, name.trim()).then(reload);
  };

  const syncUp = (s: SavedP2PCampaign) => {
    act({ kind: 'saveP2PCampaign', saved: s });
  };

  const syncDown = (s: SavedP2PCampaign) => {
    void importSavedP2P(s).then(reload);
  };

  const delServer = (s: SavedP2PCampaign) => {
    if (!window.confirm(tf('p2p.delServerConfirm', 'Eliminare "{name}" dall\'account remoto?', { name: s.name }))) return;
    act({ kind: 'deleteP2PCampaign', id: s.id });
  };

  return (
    <div className="grid" style={{ maxWidth: 860 }}>
      <div className="card">
        <h3><Icon name="save" candy size={16} /> {t('p2p.tabTitle', '💾 Campagne P2P salvate su questo dispositivo')}</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          {t('p2p.tabHint', 'Snapshot automatici delle campagne che hai hostato (senza password, max 20). Da qui: riprendi, rinomina, sincronizza col server remoto, elimina.')}
        </div>
        {saved.length === 0 && (
          <div className="muted" style={{ textAlign: 'center', padding: 16 }}>
            {t('p2p.empty', 'Nessuna campagna salvata: hostane una dalla tab 🗺️ Campagna → P2P → "Faccio da host".')}
          </div>
        )}
        {saved.map((s) => (
          <div key={s.id} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ minWidth: 0 }}>
              <b>{s.name}</b>
              <div className="muted" style={{ fontSize: 11 }}>
                {new Date(s.savedAt).toLocaleString()} · {tf('p2p.players', '{n} giocatori', { n: s.campaign.players?.length ?? 0 })}
              </div>
            </span>
            <span className="row" style={{ flexShrink: 0 }}>
              <button className="primary" onClick={() => onPlay(s.id)} title={t('p2p.resumeTitle', 'Torna in Campagna e avvia l\'host con questa campagna')}>
                <Icon name="play" size={13} /> {t('p2p.resume', 'Riprendi')}
              </button>
              <button onClick={() => rename(s)} title={t('p2p.rename', 'Rinomina')}>
                <Icon name="pencil" size={13} />
              </button>
              {auth && (
                <button onClick={() => syncUp(s)} title={t('p2p.syncUpTitle', 'Carica questa campagna sull\'account remoto (login richiesto)')}>
                  ☁️ {t('p2p.syncUp', 'sync su server')}
                </button>
              )}
              <button className="danger" onClick={() => remove(s)} title={t('p2p.del', 'Elimina dalla memoria locale')} aria-label={t('p2p.del', 'Elimina')}>
                <Icon name="x" size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3><Icon name="globe" candy size={16} /> {auth ? tf('p2p.serverTitle', '☁️ Campagne sull\'account {u} ({n})', { u: auth.username, n: auth.savedCampaigns.length }) : t('p2p.serverTitleNoAuth', '☁️ Sync con server remoto')}</h3>
        {!auth ? (
          <div className="muted">{t('p2p.noAuth', 'Fai login dall\'account (tab 👤 Account) per sincronizzare le campagne P2P con il server remoto: sopravvivono al cambio dispositivo.')}</div>
        ) : (
          <>
            <div className="muted" style={{ marginBottom: 8 }}>{t('p2p.serverHint', 'Le campagne salvate sull\'account remoto. "Salva in locale" le riporta su questo dispositivo (senza password).')}</div>
            {auth.savedCampaigns.length === 0 && <div className="muted">{t('p2p.serverEmpty', 'Nessuna campagna sull\'account: premi "☁️ sync su server" su una campagna locale.')}</div>}
            {auth.savedCampaigns.map((s) => (
              <div key={s.id} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ minWidth: 0 }}>
                  <b>{s.name}</b>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {new Date(s.savedAt).toLocaleString()} · {tf('p2p.players', '{n} giocatori', { n: s.campaign.players?.length ?? 0 })}
                  </div>
                </span>
                <span className="row" style={{ flexShrink: 0 }}>
                  <button onClick={() => syncDown(s)} title={t('p2p.syncDownTitle', 'Scarica questa campagna dal server sul dispositivo')}>
                    {t('p2p.syncDown', '⬇️ salva in locale')}
                  </button>
                  <button className="danger" onClick={() => delServer(s)} title={t('p2p.delServer', 'Elimina dal server')} aria-label={t('p2p.delServer', 'Elimina dal server')}>
                    <Icon name="x" size={13} />
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
