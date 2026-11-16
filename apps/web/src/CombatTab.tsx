import { useState } from 'react';
import {
  addCombatant,
  CONDITIONS,
  currentCombatant,
  damageCombatant,
  healCombatant,
  nextTurn,
  removeCombatant,
  rerollInitiatives,
  setCombatantCondition,
  startCombat,
  syncPlayerHp,
  type CombatState,
} from '@dnd5e/core';
import { useStore } from './store.js';

export default function CombatTab() {
  const { char } = useStore();
  const [combat, setCombat] = useState<CombatState | null>(null);
  const [name, setName] = useState('');
  const [hp, setHp] = useState(10);
  const [dmg, setDmg] = useState(3);

  if (!char) return null;

  if (!combat) {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <h3>Combattimento</h3>
        <p className="muted">Avvia un incontro: il tuo personaggio entra con initiative tirata e i suoi PF attuali.</p>
        <button className="primary" onClick={() => setCombat(syncPlayerHp(startCombat(char), char))}>⚔️ Avvia combattimento</button>
      </div>
    );
  }

  const cur = currentCombatant(combat);

  return (
    <div className="grid">
      <div className="card">
        <h3>Round {combat.round} {cur && <span className="tag custom"> turno: {cur.name}</span>}</h3>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="primary" onClick={() => setCombat(nextTurn(combat))}>Turno successivo ▶</button>
          <button onClick={() => setCombat(rerollInitiatives(combat))}>🎲 Tira initiative</button>
          <button className="danger" onClick={() => setCombat(null)}>Chiudi combattimento</button>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <input placeholder="Nome nemico" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} />
          <input type="number" min={1} value={hp} onChange={(e) => setHp(Number(e.target.value))} style={{ width: 70 }} />
          <button onClick={() => { if (name.trim()) { setCombat(addCombatant(combat, { name: name.trim(), hp })); setName(''); } }}>+ Aggiungi</button>
        </div>
        <table>
          <thead>
            <tr><th>Init</th><th>Combattente</th><th>PF</th><th>Condizioni</th><th>Azioni</th></tr>
          </thead>
          <tbody>
            {combat.combatants.map((c, i) => (
              <tr key={c.id} style={i === combat.turnIndex ? { background: 'var(--panel2)' } : undefined}>
                <td><b>{c.initiative}</b></td>
                <td>{c.name} {c.isPlayer && <span className="tag">PG</span>}</td>
                <td>{c.hp}/{c.maxHp}</td>
                <td>
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) setCombat(setCombatantCondition(combat, c.id, e.target.value, true)); }}
                    style={{ width: 130, display: 'inline-block' }}
                  >
                    <option value="">+ condizione</option>
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
