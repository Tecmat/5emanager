import { useEffect, useState } from 'react';
import type { Character } from '@dnd5e/core';
import { useStore } from './store.js';
import { deleteVersion, listVersions, type SheetVersion } from './versions.js';

/**
 * Card "Versioni della scheda": elenco degli snapshot persistenti (auto + manuali)
 * con ripristino ed eliminazione. L'auto-snapshot scatta al massimo 1/h dalla store,
 * prima del level-up e manualmente con il bottone.
 */
export default function VersionsCard() {
  const { char, setChar, snapshotActive, t, tf } = useStore();
  const [versions, setVersions] = useState<SheetVersion[]>([]);
  const [label, setLabel] = useState('');
  if (!char) return null;

  const refresh = () => { void listVersions(char.id).then(setVersions); };
  useEffect(() => { refresh(); }, [char.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const l = label.trim() || new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    snapshotActive(l);
    setLabel('');
    setTimeout(refresh, 150);
  };

  const restore = (v: SheetVersion) => {
    if (!confirm(tf('vc.restoreConfirm', 'Ripristinare la versione "{label}" ({at})? Lo stato attuale viene salvato come nuova versione "auto".', { label: v.label, at: new Date(v.at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) }))) return;
    setChar({ ...v.character, id: char.id, updatedAt: new Date().toISOString() } as Character);
    setTimeout(refresh, 150);
  };

  const remove = (v: SheetVersion) => {
    void deleteVersion(char.id, v.at).then(refresh);
  };

  return (
    <div className="card">
      <h3>{t('vc.title', '🕘 Versioni della scheda')}</h3>
      <div className="row" style={{ marginBottom: 6 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('vc.labelPh', 'etichetta (opz.)')} style={{ width: 200 }} />
        <button onClick={save}>{t('vc.save', 'Salva versione ora')}</button>
      </div>
      {versions.length === 0 && <div className="muted">{t('vc.empty', 'Nessuna versione salvata: gli snapshot automatici appariranno qui (max 1/ora) o salva manualmente.')}</div>}
      {versions.map((v) => (
        <div key={v.at} className="row" style={{ justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
          <span>
            <b>{v.label}</b>{' '}
            <span className="muted">{new Date(v.at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>{' '}
            <span className="muted">· {tf('vc.levelXp', 'liv {l} · {xp} XP', { l: v.character.classLevels?.reduce((s, c) => s + c.level, 0) ?? 1, xp: v.character.xp ?? 0 })}</span>
          </span>
          <span className="row">
            <button onClick={() => restore(v)} title={t('vc.restoreTitle', 'Ripristina questa versione')}>{t('vc.restore', 'Ripristina')}</button>
            <button className="danger" onClick={() => remove(v)} title={t('vc.deleteTitle', 'Elimina questa versione')}>✕</button>
          </span>
        </div>
      ))}
    </div>
  );
}
