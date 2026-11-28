import type { CombatState } from '@dnd5e/core';
import { useStore } from './store.js';

/**
 * Log del combattimento (voci testuali) + storico dei tiri (rollHistory):
 * mostra gli ultimi 30 eventi e gli ultimi 30 tiri in ordine cronologico inverso.
 * Usato sia nel Combattimento locale (CombatTab) sia in Campagna online.
 */
export default function CombatLog({ combat }: { combat: CombatState }) {
  const { t, tf } = useStore();
  const rolls = combat.rollHistory ?? [];
  return (
    <div className="card">
      <h3>{t('cg.log', '📜 Log')}</h3>
      <div style={{ maxHeight: 220, overflow: 'auto', fontSize: 12 }}>
        {[...combat.log].reverse().slice(0, 30).map((l, i) => <div key={i} className="muted">{l}</div>)}
      </div>
      {rolls.length > 0 && (
        <>
          <h3 style={{ marginTop: 10 }}>{t('cl.rolls', '🎲 Tiri')} <span className="muted" style={{ fontSize: 11 }}>({tf('cl.roundN', 'round {n}', { n: combat.round })})</span></h3>
          <div style={{ maxHeight: 180, overflow: 'auto', fontSize: 12 }}>
            {[...rolls].reverse().slice(0, 30).map((r, i) => (
              <div key={i} className="muted">
                <b style={{ color: 'var(--text)' }}>{r.total}</b>{' '}
                {r.kind === 'initiative' ? (
                  <>{r.actor}: {r.expr} = {r.total}</>
                ) : (
                  <>
                    {r.actor}{r.target ? ` → ${r.target}` : ''}: {r.expr} → [{r.rolls.join(', ')}] = {r.total}
                    {r.kind === 'attack' && r.hit === false && <> · {t('cl.miss', 'mancato')}</>}
                    {r.crit && <> · <span className="tag custom">★ {t('cl.crit', 'critico')}</span></>}
                  </>
                )}
                <span style={{ opacity: 0.6 }}> · {tf('cl.roundShort', 'r{n}', { n: r.round })}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
