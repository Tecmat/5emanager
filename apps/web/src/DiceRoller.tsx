import { useState } from 'react';
import { rollDice, type AdvantageMode, type DiceRollResult } from '@dnd5e/core';
import { useStore } from './store.js';
import { getUISettings } from './uiSettings.js';

const MACROS_KEY = 'dnd5e.macros.v1';
const SOUND_KEY = 'dnd5e.diceSound.v1';

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
  const [preview, setPreview] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; }
  });
  const toggleSound = () => {
    setSoundOn((v) => {
      try { localStorage.setItem(SOUND_KEY, v ? '0' : '1'); } catch { /* quota */ }
      return !v;
    });
  };

  /** click breve di dado (WebAudio, niente asset) */
  const playDiceSound = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const dur = 0.09;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 1800;
      filt.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0.25;
      src.connect(filt);
      filt.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      window.setTimeout(() => { void ctx.close(); }, 250);
    } catch { /* audio non disponibile */ }
  };

  /** limiti plausibili dell'espressione per l'animazione (somma dei dadi) */
  const exprBounds = (e: string): { min: number; max: number } => {
    const dice = [...e.matchAll(/(\d*)d(\d+)/gi)].map((m) => ({ n: Math.max(1, Number(m[1] || 1)), s: Number(m[2]) }));
    if (!dice.length) return { min: 1, max: 20 };
    return { min: dice.reduce((a, d) => a + d.n, 0), max: dice.reduce((a, d) => a + d.n * d.s, 0) };
  };

  const commit = (r: DiceRollResult | null) => {
    if (!r) {
      setHistory((h) => [{ expr, rolls: [], dropped: [], mod: 0, total: 0, mode }]);
      return;
    }
    setHistory((h) => [r, ...h].slice(0, 8));
  };

  const roll = () => {
    const r = rollDice(expr, mode);
    if (!r || !getUISettings().animations) {
      commit(r);
      if (r && soundOn) playDiceSound();
      return;
    }
    setRolling(true);
    const { min, max } = exprBounds(expr);
    const iv = window.setInterval(() => {
      setPreview(Math.floor(Math.random() * (max - min + 1)) + min);
    }, 55);
    window.setTimeout(() => {
      window.clearInterval(iv);
      setPreview(null);
      setRolling(false);
      commit(r);
      if (soundOn) playDiceSound();
    }, 420);
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
        <button onClick={toggleSound} title={soundOn ? t('dr.soundOff', 'Disattiva il suono del dado') : t('dr.soundOn', 'Attiva il suono del dado')} aria-label={soundOn ? t('dr.soundOff', 'Disattiva il suono del dado') : t('dr.soundOn', 'Attiva il suono del dado')}>
          {soundOn ? '🔊' : '🔇'}
        </button>
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
      {rolling && preview !== null && (
        <div className="dice-preview" aria-hidden="true">{preview}</div>
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
