import { useState } from 'react';
import {
  addCurrency,
  addItem,
  attunedCount,
  carryingCapacity,
  currencyToCopper,
  removeItem,
  setAttuned,
  setEquipped,
  totalWeight,
  MAX_ATTUNEMENT,
  type ItemKind,
} from '@dnd5e/core';
import { useStore } from './store.js';

const KINDS: ItemKind[] = ['weapon', 'armor', 'shield', 'gear', 'treasure', 'custom'];
const KIND_IT: Record<ItemKind, string> = { weapon: 'Arma', armor: 'Armatura', shield: 'Scudo', gear: 'Attrezzatura', treasure: 'Tesoro', custom: 'Custom' };

export default function InventoryTab() {
  const { reg, char, setChar } = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ItemKind>('gear');
  const [refId, setRefId] = useState('');
  const [w, setW] = useState(1);
  const [qty, setQty] = useState(1);
  const [magic, setMagic] = useState(false);
  const [gp, setGp] = useState(0);

  if (!char) return null;
  const curWeight = totalWeight(char);
  const cap = carryingCapacity(char);

  const add = () => {
    if (!name.trim()) return;
    const r = addItem(char, {
      name: name.trim(), kind, quantity: qty, weight: w, equipped: kind === 'weapon' || kind === 'armor' || kind === 'shield',
      refId: refId || undefined, magic, attuned: false,
    });
    setChar(r.character);
    setName('');
  };

  const refOptions = kind === 'weapon' ? [...reg.weapons.values()] : kind === 'armor' || kind === 'shield' ? [...reg.armors.values()].filter((a) => (kind === 'shield' ? a.category === 'shield' : a.category !== 'shield')) : [];

  return (
    <div className="grid">
      <div className="grid cols2">
        <div className="card">
          <h3>Peso e valuta</h3>
          <div>Peso: <b>{curWeight}</b> / {cap.normal} libbre {curWeight > cap.heavyLoad && <span className="error">sovraccarico!</span>}</div>
          <div className="muted">Monete: {currencyToCopper(char.currency)} rame totale — {char.currency.gp} mo, {char.currency.sp} ma, {char.currency.ep} me, {char.currency.cp} mr, {char.currency.pp} mp</div>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="number" style={{ width: 80 }} value={gp} onChange={(e) => setGp(Number(e.target.value))} />
            <button onClick={() => setChar(addCurrency(char, { gp }))}>Aggiungi MO</button>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>Sintonizzazione: {attunedCount(char)}/{MAX_ATTUNEMENT} oggetti magici</div>
        </div>

        <div className="card">
          <h3>Aggiungi oggetto</h3>
          <label>Nome</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pozione di guarigione" />
          <div className="grid cols2">
            <div>
              <label>Tipo</label>
              <select value={kind} onChange={(e) => { setKind(e.target.value as ItemKind); setRefId(''); }}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_IT[k]}</option>)}
              </select>
            </div>
            <div>
              <label>Riferimento (opzionale)</label>
              <select value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">(nessuno)</option>
                {refOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label>Peso</label>
              <input type="number" min={0} step={0.5} value={w} onChange={(e) => setW(Number(e.target.value))} />
            </div>
            <div>
              <label>Quantità</label>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </div>
          </div>
          <label style={{ marginTop: 8 }}><input type="checkbox" checked={magic} onChange={(e) => setMagic(e.target.checked)} style={{ width: 'auto' }} /> Oggetto magico</label>
          <div style={{ marginTop: 10 }}><button className="primary" onClick={add}>Aggiungi</button></div>
        </div>
      </div>

      <div className="card">
        <h3>Inventario ({char.inventory.length})</h3>
        {char.inventory.length === 0 && <div className="muted">Vuoto.</div>}
        <table>
          <thead>
            <tr><th>Oggetto</th><th>Tipo</th><th>Qtà</th><th>Peso</th><th>Equip.</th><th>Magico</th><th>Sint.</th><th></th></tr>
          </thead>
          <tbody>
            {char.inventory.map((it) => (
              <tr key={it.id}>
                <td>{it.name}{it.refId && <span className="muted"> ({it.refId})</span>}</td>
                <td>{KIND_IT[it.kind]}</td>
                <td>{it.quantity}</td>
                <td>{it.weight * it.quantity}</td>
                <td>
                  {(it.kind === 'weapon' || it.kind === 'armor' || it.kind === 'shield') && (
                    <input type="checkbox" checked={it.equipped} onChange={(e) => setChar(setEquipped(char, it.id, e.target.checked))} style={{ width: 'auto' }} />
                  )}
                </td>
                <td>{it.magic ? '✓' : ''}</td>
                <td>
                  {it.magic && (
                    <input type="checkbox" checked={it.attuned} onChange={(e) => {
                      const r = setAttuned(char, it.id, e.target.checked);
                      if (r.error) alert(r.error);
                      else setChar(r.character);
                    }} style={{ width: 'auto' }} />
                  )}
                </td>
                <td><button className="danger" onClick={() => setChar(removeItem(char, it.id))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
