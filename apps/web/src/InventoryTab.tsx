import { useState } from 'react';
import {
  addCurrency,
  addItem,
  attunedCount,
  carryingCapacity,
  currencyToCopper,
  moveItemToContainer,
  rechargeItem,
  removeItem,
  setAttuned,
  setCharges,
  setEquipped,
  totalWeight,
  useCharge,
  MAX_ATTUNEMENT,
  type ItemKind,
} from '@dnd5e/core';
import { useStore } from './store.js';

const KINDS: ItemKind[] = ['weapon', 'armor', 'shield', 'gear', 'treasure', 'custom'];
const KIND_IT: Record<ItemKind, string> = { weapon: 'Arma', armor: 'Armatura', shield: 'Scudo', gear: 'Attrezzatura', treasure: 'Tesoro', custom: 'Custom' };

type SortKey = 'name' | 'kind' | 'weight' | 'qty';

export default function InventoryTab() {
  const { reg, char, setChar, t, tf } = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ItemKind>('gear');
  const [refId, setRefId] = useState('');
  const [w, setW] = useState(1);
  const [qty, setQty] = useState(1);
  const [magic, setMagic] = useState(false);
  const [gp, setGp] = useState(0);
  const [container, setContainer] = useState('');
  const [chargesMax, setChargesMax] = useState('');
  const [q, setQ] = useState('');
  const [fKind, setFKind] = useState('');
  const [fMagic, setFMagic] = useState('');
  const [fEq, setFEq] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');

  if (!char) return null;
  const curWeight = totalWeight(char);
  const cap = carryingCapacity(char);

  const add = () => {
    if (!name.trim()) return;
    const maxCh = Number(chargesMax);
    const r = addItem(char, {
      name: name.trim(), kind, quantity: qty, weight: w, equipped: kind === 'weapon' || kind === 'armor' || kind === 'shield',
      refId: refId || undefined, magic, attuned: false,
      containerId: container || undefined,
      charges: chargesMax && maxCh > 0 ? { current: maxCh, max: maxCh } : undefined,
    });
    setChar(r.character);
    setName('');
    setChargesMax('');
    setContainer('');
  };

  const refOptions = kind === 'weapon' ? [...reg.weapons.values()] : kind === 'armor' || kind === 'shield' ? [...reg.armors.values()].filter((a) => (kind === 'shield' ? a.category === 'shield' : a.category !== 'shield')) : [];

  const items = char.inventory
    .filter((it) => !q.trim() || it.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((it) => !fKind || it.kind === fKind)
    .filter((it) => fMagic === '' || (fMagic === 'yes') === it.magic)
    .filter((it) => fEq === '' || (fEq === 'yes') === it.equipped)
    .sort((a, b) =>
      sortKey === 'name' ? a.name.localeCompare(b.name)
      : sortKey === 'kind' ? a.kind.localeCompare(b.kind)
      : sortKey === 'weight' ? a.weight * a.quantity - b.weight * b.quantity
      : a.quantity - b.quantity,
    );

  return (
    <div className="grid">
      <div className="grid cols2">
        <div className="card">
          <h3>{t('inv.weightCurrency', 'Peso e valuta')}</h3>
          <div>{tf('inv.weight', 'Peso: {w} / {cap} libbre', { w: curWeight, cap: cap.normal })} {curWeight > cap.heavyLoad && <span className="error">{t('inv.overload', 'sovraccarico!')}</span>}</div>
          <div className="muted">{tf('inv.coins', 'Monete: {copper} rame totale — {gp} mo, {sp} ma, {ep} me, {cp} mr, {pp} mp', { copper: currencyToCopper(char.currency), gp: char.currency.gp, sp: char.currency.sp, ep: char.currency.ep, cp: char.currency.cp, pp: char.currency.pp })}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="number" style={{ width: 80 }} value={gp} onChange={(e) => setGp(Number(e.target.value))} />
            <button onClick={() => setChar(addCurrency(char, { gp }))}>{t('inv.addGold', 'Aggiungi MO')}</button>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>{tf('inv.attunement', 'Sintonizzazione: {a}/{b} oggetti magici', { a: attunedCount(char), b: MAX_ATTUNEMENT })}</div>
        </div>

        <div className="card">
          <h3>{t('inv.addItem', 'Aggiungi oggetto')}</h3>
          <label>{t('inv.name', 'Nome')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('inv.namePh', 'Pozione di guarigione')} />
          <div className="grid cols2">
            <div>
              <label>{t('inv.kind', 'Tipo')}</label>
              <select value={kind} onChange={(e) => { setKind(e.target.value as ItemKind); setRefId(''); }}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_IT[k]}</option>)}
              </select>
            </div>
            <div>
              <label>{t('inv.ref', 'Riferimento (opzionale)')}</label>
              <select value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">{t('inv.none', '(nessuno)')}</option>
                {refOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label>{t('inv.weightL', 'Peso')}</label>
              <input type="number" min={0} step={0.5} value={w} onChange={(e) => setW(Number(e.target.value))} />
            </div>
            <div>
              <label>{t('inv.qty', 'Quantità')}</label>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </div>
            <div>
              <label>{t('inv.chargesMax', 'Cariche max (opz.)')}</label>
              <input type="number" min={0} value={chargesMax} onChange={(e) => setChargesMax(e.target.value)} placeholder={t('inv.chargesPh', 'es. 7 (bacchetta)')} />
            </div>
            <div>
              <label>{t('inv.container', 'Dentro a (contenitore)')}</label>
              <select value={container} onChange={(e) => setContainer(e.target.value)}>
                <option value="">{t('inv.root', '(radice)')}</option>
                {char.inventory.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          </div>
          <label style={{ marginTop: 8 }}><input type="checkbox" checked={magic} onChange={(e) => setMagic(e.target.checked)} style={{ width: 'auto' }} /> {t('inv.magic', 'Oggetto magico')}</label>
          <div style={{ marginTop: 10 }}><button className="primary" onClick={add}>{t('inv.add', 'Aggiungi')}</button></div>
        </div>
      </div>

      <div className="card">
        <h3>{tf('inv.inventory', 'Inventario ({a}/{b})', { a: items.length, b: char.inventory.length })}</h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <input placeholder={t('inv.search', 'Cerca...')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 160 }} />
          <select value={fKind} onChange={(e) => setFKind(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('inv.allKinds', 'tutti i tipi')}</option>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_IT[k]}</option>)}
          </select>
          <select value={fMagic} onChange={(e) => setFMagic(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('inv.magicQ', 'magico?')}</option>
            <option value="yes">{t('inv.yes', 'sì')}</option>
            <option value="no">{t('inv.no', 'no')}</option>
          </select>
          <select value={fEq} onChange={(e) => setFEq(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('inv.equippedQ', 'equipaggiato?')}</option>
            <option value="yes">{t('inv.yes', 'sì')}</option>
            <option value="no">{t('inv.no', 'no')}</option>
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ width: 'auto' }}>
            <option value="name">{t('inv.sortName', 'ordina: nome')}</option>
            <option value="kind">{t('inv.sortKind', 'ordina: tipo')}</option>
            <option value="weight">{t('inv.sortWeight', 'ordina: peso')}</option>
            <option value="qty">{t('inv.sortQty', 'ordina: quantità')}</option>
          </select>
        </div>
        {items.length === 0 && <div className="muted">{t('inv.noMatch', 'Nessun oggetto corrisponde.')}</div>}
        <table>
          <thead>
            <tr><th>{t('inv.thItem', 'Oggetto')}</th><th>{t('inv.thKind', 'Tipo')}</th><th>{t('inv.thQty', 'Qtà')}</th><th>{t('inv.thWeight', 'Peso')}</th><th>{t('inv.thCharges', 'Cariche')}</th><th>{t('inv.thContainer', 'Contenitore')}</th><th>{t('inv.thEquip', 'Equip.')}</th><th>{t('inv.thMagic', 'Magico')}</th><th>{t('inv.thAtt', 'Sint.')}</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={{ paddingLeft: it.containerId ? 20 : undefined }}>
                  {it.containerId && <span className="muted">└ </span>}
                  {it.name}{it.refId && <span className="muted"> ({it.refId})</span>}
                </td>
                <td>{KIND_IT[it.kind]}</td>
                <td>{it.quantity}</td>
                <td>{it.weight * it.quantity}</td>
                <td>
                  {it.charges ? (
                    <span className="row">
                      <b>{it.charges.current}/{it.charges.max}</b>
                      <button disabled={it.charges.current <= 0} onClick={() => { const r = useCharge(char, it.id); if (r.error) alert(r.error); else setChar(r.character); }}>−</button>
                      <button disabled={it.charges.current >= it.charges.max} onClick={() => setChar(rechargeItem(char, it.id, 1).character)}>+</button>
                      <button title={t('inv.rechargeAll', 'Ricarica tutte')} onClick={() => setChar(rechargeItem(char, it.id).character)}>⟳</button>
                    </span>
                  ) : (
                    <button title={t('inv.addCharges', '+ cariche')} onClick={() => { const m = prompt(t('inv.chargesPrompt', 'Cariche massime?'), '3'); if (m) { const r = setCharges(char, it.id, Number(m)); if (r.error) alert(r.error); else setChar(r.character); } }}>{t('inv.addCharges', '+ cariche')}</button>
                  )}
                </td>
                <td>
                  <select
                    value={it.containerId ?? ''}
                    onChange={(e) => { const r = moveItemToContainer(char, it.id, e.target.value || null); if (r.error) alert(r.error); else setChar(r.character); }}
                    style={{ width: 110 }}
                  >
                    <option value="">{t('inv.root', '(radice)')}</option>
                    {char.inventory.filter((x) => x.id !== it.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </td>
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
