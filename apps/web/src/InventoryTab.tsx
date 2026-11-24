import { useState } from 'react';
import {
  addCurrency,
  addItem,
  attunedCount,
  buyItem,
  carryingCapacity,
  craftItem,
  currencyToCopper,
  missingIngredients,
  moveItemToContainer,
  rechargeItem,
  removeItem,
  sellItem,
  setAttuned,
  setCharges,
  setEquipped,
  totalTreasureGp,
  totalWeight,
  useCharge,
  castItemSpell,
  EQUIP_SLOTS,
  equipConflicts,
  MAX_ATTUNEMENT,
  setItemSlot,
  type Currency,
  type EquipSlot,
  type ItemKind,
  type ItemRarity,
} from '@dnd5e/core';
import { SHOP_DATA, CRAFTING_DATA } from '@dnd5e/data-srd';
import { useStore } from './store.js';

const KINDS: ItemKind[] = ['weapon', 'armor', 'shield', 'gear', 'consumable', 'ammo', 'scroll', 'treasure', 'custom'];
const KIND_IT: Record<ItemKind, string> = { weapon: 'Arma', armor: 'Armatura', shield: 'Scudo', gear: 'Attrezzatura', consumable: 'Consumabile', ammo: 'Munizioni', scroll: 'Pergamena', treasure: 'Tesoro', custom: 'Custom' };
const RARITIES: ItemRarity[] = ['common', 'uncommon', 'rare', 'veryRare', 'legendary'];
const RARITY_KEY: Record<ItemRarity, string> = { common: 'inv.r.common', uncommon: 'inv.r.uncommon', rare: 'inv.r.rare', veryRare: 'inv.r.veryRare', legendary: 'inv.r.legendary' };

/** formatta una valuta come "3 mo 2 ma 5 mr" (solo le monete presenti) */
function fmtCur(c: Currency): string {
  const parts: string[] = [];
  if (c.pp) parts.push(`${c.pp} mp`);
  if (c.gp) parts.push(`${c.gp} mo`);
  if (c.ep) parts.push(`${c.ep} me`);
  if (c.sp) parts.push(`${c.sp} ma`);
  if (c.cp) parts.push(`${c.cp} mr`);
  return parts.length ? parts.join(' ') : '0 mr';
}

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
  const [valueGp, setValueGp] = useState('');
  const [rarity, setRarity] = useState<ItemRarity | ''>('');
  const [spellId, setSpellId] = useState('');
  const [fRarity, setFRarity] = useState('');
  const [q, setQ] = useState('');
  const [fKind, setFKind] = useState('');
  const [fMagic, setFMagic] = useState('');
  const [fEq, setFEq] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [shopQty, setShopQty] = useState<Record<string, number>>({});
  const [shopMsg, setShopMsg] = useState('');

  if (!char) return null;
  const curWeight = totalWeight(char);
  const cap = carryingCapacity(char);
  const conflicts = equipConflicts(char);

  const add = () => {
    if (!name.trim()) return;
    const maxCh = Number(chargesMax);
    const v = Number(valueGp);
    const r = addItem(char, {
      name: name.trim(), kind, quantity: qty, weight: w, equipped: kind === 'weapon' || kind === 'armor' || kind === 'shield',
      refId: refId || undefined, magic, attuned: false,
      containerId: container || undefined,
      charges: chargesMax && maxCh > 0 ? { current: maxCh, max: maxCh } : undefined,
      valueGp: valueGp && v > 0 ? v : undefined,
      rarity: rarity || undefined,
      spellId: spellId || undefined,
    });
    if (r.error) { alert(r.error); return; }
    setChar(r.character);
    setName('');
    setChargesMax('');
    setContainer('');
    setValueGp('');
    setRarity('');
    setSpellId('');
  };

  const refOptions = kind === 'weapon' ? [...reg.weapons.values()] : kind === 'armor' || kind === 'shield' ? [...reg.armors.values()].filter((a) => (kind === 'shield' ? a.category === 'shield' : a.category !== 'shield')) : [];

  const items = char.inventory
    .filter((it) => !q.trim() || it.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((it) => !fKind || it.kind === fKind)
    .filter((it) => fMagic === '' || (fMagic === 'yes') === it.magic)
    .filter((it) => fEq === '' || (fEq === 'yes') === it.equipped)
    .filter((it) => !fRarity || it.rarity === fRarity)
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
          <div style={{ marginTop: 4 }}><b>{tf('inv.treasure', 'Tesoro totale: {gp} mo', { gp: Math.round(totalTreasureGp(char) * 100) / 100 })}</b></div>
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
            <div>
              <label>{t('inv.value', 'Valore (MO)')}</label>
              <input type="number" min={0} value={valueGp} onChange={(e) => setValueGp(e.target.value)} placeholder="50" />
            </div>
            <div>
              <label>{t('inv.rarity', 'Rarità')}</label>
              <select value={rarity} onChange={(e) => setRarity(e.target.value as ItemRarity | '')}>
                <option value="">{t('inv.none', '(nessuno)')}</option>
                {RARITIES.map((r) => <option key={r} value={r}>{t(RARITY_KEY[r], r)}</option>)}
              </select>
            </div>
            <div>
              <label>{t('inv.spellField', 'Incantesimo lanciato (pergamena/bacchetta, opz.)')}</label>
              <select value={spellId} onChange={(e) => setSpellId(e.target.value)}>
                <option value="">{t('inv.none', '(nessuno)')}</option>
                {char.spellsKnown.map((sid) => <option key={sid} value={sid}>{reg.spells.get(sid)?.name ?? sid}</option>)}
              </select>
            </div>
          </div>
          <label style={{ marginTop: 8 }}><input type="checkbox" checked={magic} onChange={(e) => setMagic(e.target.checked)} style={{ width: 'auto' }} /> {t('inv.magic', 'Oggetto magico')}</label>
          <div style={{ marginTop: 10 }}><button className="primary" onClick={add}>{t('inv.add', 'Aggiungi')}</button></div>
        </div>
      </div>

      <div className="grid cols2">
        <div className="card">
          <h3>🛒 {t('inv.shop', 'Negozio')}</h3>
          <div className="muted" style={{ marginBottom: 6 }}>{t('inv.shopHint', 'Acquista con le monete del PG: il costo viene scalato e il resto calcolato automaticamente.')}</div>
          {SHOP_DATA.map((it) => {
            const q = shopQty[it.id] ?? 1;
            return (
              <div key={it.id} className="row" style={{ justifyContent: 'space-between', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span>
                  <b>{it.name}</b>
                  <span className="muted"> · {KIND_IT[it.kind]} · {it.valueGp} mo{it.magic ? ' · ✨' : ''}</span>
                </span>
                <span className="row">
                  <input type="number" min={1} value={q} onChange={(e) => setShopQty({ ...shopQty, [it.id]: Number(e.target.value) })} style={{ width: 56 }} title={t('inv.qty', 'Quantità')} />
                  <button
                    className="primary"
                    disabled={q < 1 || currencyToCopper(char.currency) < it.valueGp * 100 * q}
                    title={tf('inv.buyTitle', 'Compra {q}× {name} per {gp} mo', { q, name: it.name, gp: it.valueGp * q })}
                    onClick={() => {
                      const r = buyItem(char, it, q);
                      if (r.error) { setShopMsg(r.error); return; }
                      setChar(r.character);
                      setShopMsg(tf('inv.bought', 'Acquistato {q}× {name} per {gp} mo — resto: {ch}', { q, name: it.name, gp: r.spentGp, ch: fmtCur(r.change) }));
                    }}
                  >
                    {t('inv.buy', 'Compra')}
                  </button>
                </span>
              </div>
            );
          })}
        </div>

        <div className="card">
          <h3>⚒️ {t('inv.craft', 'Crafting')}</h3>
          <div className="muted" style={{ marginBottom: 6 }}>{t('inv.craftHint', "Crea oggetti consumando gli ingredienti dall'inventario più un costo in MO.")}</div>
          {CRAFTING_DATA.map((rc) => {
            const missing = missingIngredients(char, rc);
            const afford = currencyToCopper(char.currency) >= rc.costGp * 100;
            return (
              <div key={rc.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                  <b>{rc.name}</b>
                  <button
                    className="primary"
                    disabled={missing.length > 0 || !afford}
                    title={missing.length ? tf('inv.missingTitle', 'Mancano: {list}', { list: missing.map((m) => `${m.name} x${m.quantity}`).join(', ') }) : tf('inv.craftTitle', 'Crea {name} per {gp} mo', { name: rc.result.name, gp: rc.costGp })}
                    onClick={() => {
                      const r = craftItem(char, rc);
                      if (r.error) { setShopMsg(r.error); return; }
                      setChar(r.character);
                      setShopMsg(tf('inv.crafted', 'Creato {name} (costo {gp} mo) — resto: {ch}', { name: rc.result.name, gp: rc.costGp, ch: fmtCur(r.change) }));
                    }}
                  >
                    {t('inv.craftBtn', 'Crea')} ({rc.costGp} mo)
                  </button>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {rc.ingredients.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                  {missing.length > 0 && <span className="error"> — {tf('inv.missing', 'mancano {list}', { list: missing.map((m) => `${m.name} x${m.quantity}`).join(', ') })}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {shopMsg && <div className="ok">{shopMsg}</div>}

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
          <select value={fRarity} onChange={(e) => setFRarity(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('inv.allRarity', 'tutte le rarità')}</option>
            {RARITIES.map((r) => <option key={r} value={r}>{t(RARITY_KEY[r], r)}</option>)}
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ width: 'auto' }}>
            <option value="name">{t('inv.sortName', 'ordina: nome')}</option>
            <option value="kind">{t('inv.sortKind', 'ordina: tipo')}</option>
            <option value="weight">{t('inv.sortWeight', 'ordina: peso')}</option>
            <option value="qty">{t('inv.sortQty', 'ordina: quantità')}</option>
          </select>
        </div>
        {items.length === 0 && <div className="muted">{t('inv.noMatch', 'Nessun oggetto corrisponde.')}</div>}
        {conflicts.length > 0 && (
          <div className="error" style={{ marginBottom: 6 }}>
            {t('inv.conflict', 'Conflitto di equipaggiamento: più oggetti nello stesso slot')} ({conflicts.map((c) => t('inv.slot.' + c.slot, c.slot)).join(', ')})
          </div>
        )}
        <table>
          <thead>
            <tr><th>{t('inv.thItem', 'Oggetto')}</th><th>{t('inv.thKind', 'Tipo')}</th><th>{t('inv.thQty', 'Qtà')}</th><th>{t('inv.thWeight', 'Peso')}</th><th>{t('inv.thRarity', 'Rarità')}</th><th>{t('inv.thValue', 'Valore')}</th><th>{t('inv.thCharges', 'Cariche')}</th><th>{t('inv.thContainer', 'Contenitore')}</th><th>{t('inv.thEquip', 'Equip.')}</th><th>{t('inv.thSlot', 'Slot')}</th><th>{t('inv.thMagic', 'Magico')}</th><th>{t('inv.thAtt', 'Sint.')}</th><th></th></tr>
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
                <td>{it.rarity ? t(RARITY_KEY[it.rarity], it.rarity) : ''}</td>
                <td>{it.valueGp ? `${it.valueGp * it.quantity} mo` : ''}</td>
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
                <td>
                  <select
                    value={it.slot ?? ''}
                    onChange={(e) => setChar(setItemSlot(char, it.id, (e.target.value || null) as EquipSlot | null))}
                    style={{ width: 96 }}
                    title={t('inv.slotTitle', 'Slot di equipaggiamento occupato (un solo oggetto per slot)')}
                  >
                    <option value="">{t('inv.noSlot', '— auto —')}</option>
                    {EQUIP_SLOTS.map((s) => <option key={s.id} value={s.id}>{t('inv.slot.' + s.id, s.name)}</option>)}
                  </select>
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
                <td>
                  <span className="row">
                    {it.spellId && it.charges && it.charges.current > 0 && (
                      <button
                        title={t('inv.castTitle', "Lancia l'incantesimo dell'oggetto spendendo 1 carica (senza slot)")}
                        onClick={() => { const r = castItemSpell(char, it.id, reg); if (r.error) alert(r.error); else setChar(r.character); }}
                      >
                        {t('inv.castSpell', '✨ lancia')}
                      </button>
                    )}
                    {it.valueGp ? (
                      <button
                        title={t('inv.sellTitle', 'Vendi 1 unità al suo valore')}
                        onClick={() => { const r = sellItem(char, it.id); if (r.error) alert(r.error); else setChar(r.character); }}
                      >
                        {tf('inv.sell', '💰 +{gp} mo', { gp: it.valueGp ?? 0 })}
                      </button>
                    ) : null}
                    <button className="danger" onClick={() => setChar(removeItem(char, it.id))}>✕</button>
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
