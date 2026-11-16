import { useState } from 'react';
import { rollDice, type AdvantageMode, type DiceRollResult } from '@dnd5e/core';

export default function DiceRoller() {
  const [expr, setExpr] = useState('1d20');
  const [mode, setMode] = useState<AdvantageMode>('none');
  const [history, setHistory] = useState<DiceRollResult[]>([]);

  const roll = () => {
    const r = rollDice(expr, mode);
    if (!r) {
      setHistory((h) => [{ expr, rolls: [], dropped: [], mod: 0, total: 0, mode }]);
      return;
    }
    setHistory((h) => [r, ...h].slice(0, 8));
  };

  return (
    <div className="card">
      <h3>🎲 Tira dado</h3>
      <div className="row">
        <input value={expr} onChange={(e) => setExpr(e.target.value)} style={{ width: 110 }} placeholder="2d6+3" />
        <select value={mode} onChange={(e) => setMode(e.target.value as AdvantageMode)} style={{ width: 130 }}>
          <option value="none">Normale</option>
          <option value="advantage">Vantaggio</option>
          <option value="disadvantage">Svantaggio</option>
        </select>
        <button className="primary" onClick={roll}>Tira</button>
      </div>
      <div style={{ marginTop: 8 }}>
        {history.map((r, i) => (
          <div key={i} className="muted" style={{ fontSize: 12 }}>
            <b style={{ color: 'var(--text)', fontSize: 14 }}>{r.total}</b>{' '}
            {r.expr} → [{r.rolls.join(', ')}]{r.dropped.length ? ` (scartati: ${r.dropped.join(', ')})` : ''}{r.mod ? ` ${r.mod > 0 ? '+' : ''}${r.mod}` : ''}
            {r.mode !== 'none' ? ` · ${r.mode === 'advantage' ? 'vantaggio' : 'svantaggio'}` : ''}
            {r.rolls.length === 0 && r.total === 0 && r.expr === expr ? ' — espressione non valida' : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
