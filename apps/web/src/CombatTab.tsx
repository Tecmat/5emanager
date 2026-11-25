import { useEffect, useState } from 'react';
import {
  addCombatant,
  clearTemplate,
  CONDITIONS,
  currentCombatant,
  damageCombatant,
  healCombatant,
  logJournal,
  moveToken,
  nextTurn,
  removeCombatant,
  rerollInitiatives,
  setCombatantCondition,
  setMapSize,
  setTemplate,
  setTurnTimer,
  startCombat,
  syncPlayerHp,
  type CombatState,
  type TemplateShape,
} from '@dnd5e/core';
import { useStore } from './store.js';
import TemplateView from './TemplateView.js';
import TacticalMap from './TacticalMap.js';

export default function CombatTab() {
  const { char, setChar, reg, t, tf } = useStore();
  const [combat, setCombat] = useState<CombatState | null>(null);
  const [name, setName] = useState('');
  const [hp, setHp] = useState(10);
  const [dmg, setDmg] = useState(3);
  const [showTpl, setShowTpl] = useState(false);
  const [tplShape, setTplShape] = useState<TemplateShape>('cone');
  const [tplSize, setTplSize] = useState(15);
  const [tplWidth, setTplWidth] = useState(5);
  const [timerSec, setTimerSec] = useState(60);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const iv = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, []);

  if (!char) return null;

  if (!combat) {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <h3>{t('cb.title', 'Combattimento')}</h3>
        <p className="muted">{t('cb.startHint', 'Avvia un incontro: il tuo personaggio entra con initiative tirata e i suoi PF attuali.')}</p>
        <button className="primary" onClick={() => setCombat(syncPlayerHp(startCombat(char), char))}>{t('cb.start', '⚔️ Avvia combattimento')}</button>
      </div>
    );
  }

  const cur = currentCombatant(combat);
  // countdown del turno (riparte da turnStartedAt a ogni cambio turno, impostato dal core)
  const timerLeft = combat.turnTimerSec && combat.turnStartedAt
    ? Math.max(0, combat.turnTimerSec - Math.floor((nowMs - new Date(combat.turnStartedAt).getTime()) / 1000))
    : null;

  const dropConcentration = () => {
    if (!char?.concentrationSpellId) return;
    const sp = reg.spells.get(char.concentrationSpellId)?.name ?? char.concentrationSpellId;
    setChar(logJournal({ ...char, concentrationSpellId: undefined }, `Interrompe la concentrazione su ${sp}`));
    setCombat((c) => (c ? { ...c, combatants: c.combatants.map((cb) => (cb.isPlayer ? { ...cb, concentrating: undefined } : cb)) } : c));
  };

  return (
    <div className="grid">
      <div className="card">
        <h3>{tf('cb.round', 'Round {n}', { n: combat.round })} {cur && <span className="tag custom"> {tf('cb.turn', 'turno: {name}', { name: cur.name })}</span>}</h3>
        <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          <button className="primary" onClick={() => setCombat(nextTurn(combat))}>{t('cb.next', 'Turno successivo ▶')}</button>
          <button onClick={() => setCombat(rerollInitiatives(combat))}>{t('cb.reroll', '🎲 Tira initiative')}</button>
          <button className="danger" onClick={() => setCombat(null)}>{t('cb.close', 'Chiudi combattimento')}</button>
          <span
            className="tag"
            style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums', color: timerLeft !== null && timerLeft <= 10 ? 'var(--danger)' : undefined }}
            title={t('cb.timerTitle', 'Timer del turno: riparte a ogni turno quando è attivo')}
          >
            ⏱ {timerLeft !== null ? `${Math.floor(timerLeft / 60)}:${String(timerLeft % 60).padStart(2, '0')}` : '—'}
          </span>
          <input
            type="number" min={0} step={5} value={timerSec}
            onChange={(e) => {
              const v = Math.max(0, Number(e.target.value));
              setTimerSec(v);
              setCombat((c) => (c ? setTurnTimer(c, v) : c));
            }}
            style={{ width: 56 }}
            title={t('cb.timerSec', 'Secondi per turno (0 = disattiva)')}
          />
          {combat.turnTimerSec ? (
            <button onClick={() => setCombat((c) => (c ? setTurnTimer(c, 0) : c))} title={t('cb.timerOff', 'Disattiva il timer di turno')}>{t('cb.timerOffBtn', 'timer off')}</button>
          ) : null}
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <button onClick={() => setShowTpl((v) => !v)} title={t('cb.tpl', '📐 template')}>{t('cb.tpl', '📐 template')}</button>
          {showTpl && (
            <span className="row">
              <select value={tplShape} onChange={(e) => setTplShape(e.target.value as TemplateShape)} style={{ width: 'auto' }}>
                <option value="cone">{t('cb.cone', 'cono')}</option>
                <option value="sphere">{t('cb.sphere', 'sfera')}</option>
                <option value="line">{t('cb.line', 'linea')}</option>
                <option value="cube">{t('cb.cube', 'cubo')}</option>
              </select>
              <label className="row" style={{ margin: 0, fontSize: 12 }}>
                {t('cb.tplSize', 'misura (ft)')}
                <input type="number" min={5} step={5} value={tplSize} onChange={(e) => setTplSize(Number(e.target.value))} style={{ width: 60 }} />
              </label>
              {tplShape === 'line' && (
                <label className="row" style={{ margin: 0, fontSize: 12 }}>
                  {t('cb.tplWidth', 'larghezza (ft)')}
                  <input type="number" min={5} step={5} value={tplWidth} onChange={(e) => setTplWidth(Number(e.target.value))} style={{ width: 60 }} />
                </label>
              )}
              <button
                disabled={!cur}
                onClick={() => setCombat(setTemplate(combat, { shape: tplShape, sizeFt: tplSize, widthFt: tplShape === 'line' ? tplWidth : undefined, originId: cur?.id }))}
              >
                {t('cb.tplPlace', 'Piazza sul turno corrente')}
              </button>
              {combat.template && (
                <button className="danger" onClick={() => setCombat(clearTemplate(combat))}>{t('cb.tplClear', 'Rimuovi')}</button>
              )}
            </span>
          )}
        </div>
        {combat.template && (
          <div style={{ marginBottom: 10, maxWidth: 420 }}>
            <TemplateView tpl={combat.template} />
          </div>
        )}
        <div style={{ maxWidth: 620, marginBottom: 10 }}>
          <TacticalMap
            combat={combat}
            currentTurnId={cur?.id}
            canMove={() => true}
            onMove={(id, x, y) => setCombat(moveToken(combat, id, x, y))}
            canResize
            onResize={(cols, rows) => setCombat(setMapSize(combat, cols, rows))}
          />
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <input placeholder={t('cb.enemyPh', 'Nome nemico')} value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} />
          <input type="number" min={1} value={hp} onChange={(e) => setHp(Number(e.target.value))} style={{ width: 70 }} />
          <button onClick={() => { if (name.trim()) { setCombat(addCombatant(combat, { name: name.trim(), hp })); setName(''); } }}>{t('cb.add', '+ Aggiungi')}</button>
        </div>
        <table>
          <thead>
            <tr><th>{t('cb.thInit', 'Init')}</th><th>{t('cb.thCombatant', 'Combattente')}</th><th>{t('cb.thHp', 'PF')}</th><th>{t('cb.thCond', 'Condizioni')}</th><th>{t('cb.thActions', 'Azioni')}</th></tr>
          </thead>
          <tbody>
            {combat.combatants.map((c, i) => (
              <tr key={c.id} style={i === combat.turnIndex ? { background: 'var(--panel2)' } : undefined}>
                <td><b>{c.initiative}</b></td>
                <td>
                  {c.name} {c.isPlayer && <span className="tag">{t('cb.player', 'PG')}</span>}
                  {c.concentrating && (
                    <span className="tag custom" title={t('cb.concTitle', 'Concentrazione attiva')}>
                      🎯 {reg.spells.get(c.concentrating)?.name ?? c.concentrating}
                      {c.isPlayer && (
                        <button style={{ padding: '0 5px', marginLeft: 4 }} title={t('cb.dropConc', 'Interrompi la concentrazione')} onClick={dropConcentration}>✕</button>
                      )}
                    </span>
                  )}
                </td>
                <td>{c.hp}/{c.maxHp}</td>
                <td>
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) setCombat(setCombatantCondition(combat, c.id, e.target.value, true)); }}
                    style={{ width: 130, display: 'inline-block' }}
                  >
                    <option value="">{t('cb.addCond', '+ condizione')}</option>
                    {CONDITIONS.map((cd) => <option key={cd.id} value={cd.id}>{cd.name}</option>)}
                  </select>
                  {c.conditions.map((cd) => (
                    <span key={cd} className="tag custom" style={{ cursor: 'pointer' }} onClick={() => setCombat(setCombatantCondition(combat, c.id, cd, false))}>
                      {CONDITIONS.find((x) => x.id === cd)?.name ?? cd} ✕
                    </span>
                  ))}
                </td>
                <td>
                  <span className="row">
                    <input type="number" value={dmg} onChange={(e) => setDmg(Number(e.target.value))} style={{ width: 56 }} />
                    <button onClick={() => setCombat(damageCombatant(combat, c.id, dmg))}>-</button>
                    <button onClick={() => setCombat(healCombatant(combat, c.id, dmg))}>+</button>
                    <button className="danger" onClick={() => setCombat(removeCombatant(combat, c.id))}>✕</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
