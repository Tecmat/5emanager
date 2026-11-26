import { useState } from 'react';
import { rollDice, type AdvantageMode, type DiceRollResult } from '@dnd5e/core';
import { useStore } from './store.js';

const MACROS_KEY = 'dnd5e.macros.v1';

export default function DiceRoller() {
  const { t, tf } = useStore();
  const [expr, setExpr] = useState('1d20');
  const [mode, setMode] = useState<AdvantageMode>('none');
  const [history, setHistory] = useState<DiceRollResult[]>([]);
  const [macros, setMacros] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(MACROS_KEY) ?? '[]') as string[]; } catch { return []; }
  });
  const saveMacros = (m: string[]) => {
    setMacros(m);
    try { localStorage.setItem(MACROS_KEY, JSON.stringify(m)); } catch { /* quota */ }
  };

  const [rolling, setRolling] = useState(false);

  const roll = () => {
    const r = rollDice(expr, mode);
    setRolling(true);
    window.setTimeout(() => setRolling(false), 380);
    if (!r) {
      setHistory((h) => [{ expr, rolls: [], dropped: [], mod: 0, total: 0, mode }]);
      return;
    }
    setHistory((h) => [r, ...h].slice(0, 8));
  };

  return (
    <div className="card">
      <h3>{t('dr.title', '🎲 Tira dado')}</h3>
      <div className="row">
        <input value={expr} onChange={(e) => setExpr(e.target.value)} style={{ width: 110 }} placeholder="2d6+3" />
        <select value={mode} onChange={(e) => setMode(e.target.value as AdvantageMode)} style={{ width: 130 }}>
          <option value="none">{t('dr.normal', 'Normale')}</option>
          <option value="advantage">{t('dr.advantage', 'Vantaggio')}</option>
          <option value="disadvantage">{t('dr.disadvantage', 'Svantaggio')}</option>
        </select>
        <button className={`primary ${rolling ? 'rolling' : ''}`} onClick={roll}>🎲 {t('dr.roll', 'Tira')}</button>
        <button
          title={t('dr.macroAdd', 'Salva espressione come macro')}
          onClick={() => { const e = expr.trim(); if (e && !macros.includes(e)) saveMacros([...macros, e]); }}
        >
          + 📌
        </button>
      </div>
      {macros.length > 0 && (
        <div className="row" style={{ marginTop: 6 }}>
          <span className="muted">{t('dr.macro', 'Macro:')}</span>
          {macros.map((m) => (
            <span key={m} className="tag custom" style={{ cursor: 'pointer' }} title={m} onClick={() => setExpr(m)}>
              {m}
              <button
                style={{ padding: '0 4px', marginLeft: 2, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); saveMacros(macros.filter((x) => x !== m)); }}
                aria-label={`✕ ${m}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {history.map((r, i) => {
          const isD20 = /(^|[^a-z])d20($|[^0-9])/i.test(r.expr);
          const crit = isD20 && r.rolls.includes(20);
          const fumble = isD20 && r.rolls.includes(1);
          return (
          <div key={i} className={`muted dice-row${crit ? ' crit' : ''}${fumble ? ' fumble' : ''}`} style={{ fontSize: 12 }}>
            <b className="dice-total" style={{ color: 'var(--text)', fontSize: 14 }}>{r.total}</b>{' '}
            {crit && <span className="tag custom">★ {t('dr.crit', 'Critico!')}</span>}
            {fumble && <span className="tag" style={{ borderColor: '#b04040', color: '#e08080' }}>✗ {t('dr.fumble', 'Fallimento critico')}</span>}{' '}
            {r.expr} → [{r.rolls.join(', ')}]{r.dropped.length ? ` (${tf('dr.dropped', 'scartati: {list}', { list: r.dropped.join(', ') })})` : ''}{r.mod ? ` ${r.mod > 0 ? '+' : ''}${r.mod}` : ''}
            {r.mode !== 'none' ? ` · ${r.mode === 'advantage' ? t('dr.adv', 'vantaggio') : t('dr.dis', 'svantaggio')}` : ''}
            {r.rolls.length === 0 && r.total === 0 && r.expr === expr ? ` — ${t('dr.invalid', 'espressione non valida')}` : ''}
          </div>
          );
        })}
      </div>
    </div>
  );
}
