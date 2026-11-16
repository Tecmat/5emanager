import { useState } from 'react';
import {
  addCustomArmor,
  addCustomClass,
  addCustomSpell,
  addCustomWeapon,
  exportCustomContent,
  type School,
} from '@dnd5e/core';
import { useStore, persistCustom } from './store.js';

const SCHOOLS: School[] = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];

export default function CustomTab() {
  const { reg, reloadCustom } = useStore();
  const [kind, setKind] = useState<'spell' | 'weapon' | 'armor' | 'class'>('spell');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [spell, setSpell] = useState({ id: '', name: '', level: 0, school: 'evocation' as School, castingTime: '1 azione', range: '9 m', components: 'V, S', duration: 'Istantanea', description: '', damage: '', classes: 'wizard' });
  const [weapon, setWeapon] = useState({ id: '', name: '', category: 'martial' as 'simple' | 'martial', type: 'melee' as 'melee' | 'ranged', damage: '1d8', damageType: 'taglio', properties: '', weight: 3, costGp: 15, bonus: 0 });
  const [armor, setArmor] = useState({ id: '', name: '', category: 'light' as 'light' | 'medium' | 'heavy' | 'shield', ac: 12, maxDex: '', weight: 10, costGp: 10 });
  const [clsJson, setClsJson] = useState('');

  const save = () => persistCustom(exportCustomContent(reg));

  const submit = () => {
    let r: { ok: boolean; errors: string[] } | null = null;
    if (kind === 'spell') {
      r = addCustomSpell(reg, {
        id: spell.id, name: spell.name, level: spell.level, school: spell.school,
        castingTime: spell.castingTime, range: spell.range, components: spell.components,
        duration: spell.duration, description: spell.description,
        damage: spell.damage || undefined,
        classes: spell.classes.split(',').map((s) => s.trim()).filter(Boolean),
        source: 'custom',
      });
    } else if (kind === 'weapon') {
      r = addCustomWeapon(reg, {
        id: weapon.id, name: weapon.name, category: weapon.category, type: weapon.type,
        damage: weapon.damage, damageType: weapon.damageType,
        properties: weapon.properties.split(',').map((s) => s.trim()).filter(Boolean),
        weight: weapon.weight, cost: { value: weapon.costGp, unit: 'gp' },
        bonus: weapon.bonus || undefined, source: 'custom',
      });
    } else if (kind === 'armor') {
      r = addCustomArmor(reg, {
        id: armor.id, name: armor.name, category: armor.category, ac: armor.ac,
        maxDex: armor.maxDex === '' ? undefined : Number(armor.maxDex),
        weight: armor.weight, cost: { value: armor.costGp, unit: 'gp' }, source: 'custom',
      });
    } else {
      try {
        const parsed = JSON.parse(clsJson);
        r = addCustomClass(reg, parsed);
      } catch (e) {
        r = { ok: false, errors: ['JSON non valido: ' + (e as Error).message] };
      }
    }
    if (r && r.ok) {
      save();
      reloadCustom();
      setMsg({ ok: true, text: 'Contenuto aggiunto e salvato.' });
    } else {
      setMsg({ ok: false, text: (r?.errors ?? ['errore']).join('\n') });
    }
  };

  const customs = {
    incantesimi: [...reg.spells.values()].filter((s) => s.source === 'custom'),
    armi: [...reg.weapons.values()].filter((w) => w.source === 'custom'),
    armature: [...reg.armors.values()].filter((a) => a.source === 'custom'),
    classi: [...reg.classes.values()].filter((c) => c.source === 'custom'),
  };

  return (
    <div className="grid cols2">
      <div className="card">
        <h3>Aggiungi contenuto custom</h3>
        <label>Tipo</label>
        <select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setMsg(null); }}>
          <option value="spell">Incantesimo</option>
          <option value="weapon">Arma</option>
          <option value="armor">Armatura/Scudo</option>
          <option value="class">Classe (JSON)</option>
        </select>

        {kind === 'spell' && (
          <>
            <label>ID (es. dardo-del-drago)</label><input value={spell.id} onChange={(e) => setSpell({ ...spell, id: e.target.value })} />
            <label>Nome</label><input value={spell.name} onChange={(e) => setSpell({ ...spell, name: e.target.value })} />
            <div className="grid cols2">
              <div><label>Livello (0-9)</label><input type="number" min={0} max={9} value={spell.level} onChange={(e) => setSpell({ ...spell, level: Number(e.target.value) })} /></div>
              <div><label>Scuola</label><select value={spell.school} onChange={(e) => setSpell({ ...spell, school: e.target.value as School })}>{SCHOOLS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              <div><label>Tempo</label><input value={spell.castingTime} onChange={(e) => setSpell({ ...spell, castingTime: e.target.value })} /></div>
              <div><label>Portata</label><input value={spell.range} onChange={(e) => setSpell({ ...spell, range: e.target.value })} /></div>
              <div><label>Componenti</label><input value={spell.components} onChange={(e) => setSpell({ ...spell, components: e.target.value })} /></div>
              <div><label>Durata</label><input value={spell.duration} onChange={(e) => setSpell({ ...spell, duration: e.target.value })} /></div>
              <div><label>Dado danno (opz.)</label><input value={spell.damage} onChange={(e) => setSpell({ ...spell, damage: e.target.value })} placeholder="3d6" /></div>
              <div><label>Classi (separate da virgola)</label><input value={spell.classes} onChange={(e) => setSpell({ ...spell, classes: e.target.value })} /></div>
            </div>
            <label>Descrizione</label><textarea rows={3} value={spell.description} onChange={(e) => setSpell({ ...spell, description: e.target.value })} />
          </>
        )}

        {kind === 'weapon' && (
          <>
            <label>ID</label><input value={weapon.id} onChange={(e) => setWeapon({ ...weapon, id: e.target.value })} />
            <label>Nome</label><input value={weapon.name} onChange={(e) => setWeapon({ ...weapon, name: e.target.value })} />
            <div className="grid cols2">
              <div><label>Categoria</label><select value={weapon.category} onChange={(e) => setWeapon({ ...weapon, category: e.target.value as 'simple' | 'martial' })}><option value="simple">simple</option><option value="martial">martial</option></select></div>
              <div><label>Mischia/distanza</label><select value={weapon.type} onChange={(e) => setWeapon({ ...weapon, type: e.target.value as 'melee' | 'ranged' })}><option value="melee">melee</option><option value="ranged">ranged</option></select></div>
              <div><label>Dado danno</label><input value={weapon.damage} onChange={(e) => setWeapon({ ...weapon, damage: e.target.value })} placeholder="1d8" /></div>
              <div><label>Tipo danno</label><input value={weapon.damageType} onChange={(e) => setWeapon({ ...weapon, damageType: e.target.value })} /></div>
              <div><label>Proprietà (virgola)</label><input value={weapon.properties} onChange={(e) => setWeapon({ ...weapon, properties: e.target.value })} placeholder="finesse, leggera" /></div>
              <div><label>Peso</label><input type="number" value={weapon.weight} onChange={(e) => setWeapon({ ...weapon, weight: Number(e.target.value) })} /></div>
              <div><label>Costo (MO)</label><input type="number" value={weapon.costGp} onChange={(e) => setWeapon({ ...weapon, costGp: Number(e.target.value) })} /></div>
              <div><label>Bonus magico (0 = no)</label><input type="number" value={weapon.bonus} onChange={(e) => setWeapon({ ...weapon, bonus: Number(e.target.value) })} /></div>
            </div>
          </>
        )}

        {kind === 'armor' && (
          <>
            <label>ID</label><input value={armor.id} onChange={(e) => setArmor({ ...armor, id: e.target.value })} />
            <label>Nome</label><input value={armor.name} onChange={(e) => setArmor({ ...armor, name: e.target.value })} />
            <div className="grid cols2">
              <div><label>Categoria</label><select value={armor.category} onChange={(e) => setArmor({ ...armor, category: e.target.value as typeof armor.category })}><option value="light">leggera</option><option value="medium">media</option><option value="heavy">pesante</option><option value="shield">scudo</option></select></div>
              <div><label>CA</label><input type="number" value={armor.ac} onChange={(e) => setArmor({ ...armor, ac: Number(e.target.value) })} /></div>
              <div><label>Des max (vuoto = illimitato)</label><input value={armor.maxDex} onChange={(e) => setArmor({ ...armor, maxDex: e.target.value })} /></div>
              <div><label>Peso</label><input type="number" value={armor.weight} onChange={(e) => setArmor({ ...armor, weight: Number(e.target.value) })} /></div>
              <div><label>Costo (MO)</label><input type="number" value={armor.costGp} onChange={(e) => setArmor({ ...armor, costGp: Number(e.target.value) })} /></div>
            </div>
          </>
        )}

        {kind === 'class' && (
          <>
            <label>Definizione classe in JSON (vedi packages/data-srd/data/classes/*.json come esempio)</label>
            <textarea rows={12} value={clsJson} onChange={(e) => setClsJson(e.target.value)} placeholder='{ "id": "...", "name": "...", "hitDie": 8, ... }' />
          </>
        )}

        {msg && <div className={msg.ok ? 'ok' : 'error'} style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{msg.text}</div>}
        <div style={{ marginTop: 10 }}><button className="primary" onClick={submit}>Salva</button></div>
      </div>

      <div className="card">
        <h3>I tuoi contenuti custom</h3>
        <div><b>Incantesimi:</b> {customs.incantesimi.length ? customs.incantesimi.map((s) => <span key={s.id} className="tag custom">{s.name}</span>) : <span className="muted">nessuno</span>}</div>
        <div style={{ marginTop: 6 }}><b>Armi:</b> {customs.armi.length ? customs.armi.map((w) => <span key={w.id} className="tag custom">{w.name}</span>) : <span className="muted">nessuno</span>}</div>
        <div style={{ marginTop: 6 }}><b>Armature:</b> {customs.armature.length ? customs.armature.map((a) => <span key={a.id} className="tag custom">{a.name}</span>) : <span className="muted">nessuno</span>}</div>
        <div style={{ marginTop: 6 }}><b>Classi:</b> {customs.classi.length ? customs.classi.map((c) => <span key={c.id} className="tag custom">{c.name}</span>) : <span className="muted">nessuno</span>}</div>
        <div className="muted" style={{ marginTop: 10 }}>I custom sono salvati in locale (localStorage) e possono essere esportati come JSON da qui: usa "Esporta JSON" nella panoramica per la scheda; per i contenuti custom il salvataggio è automatico.</div>
      </div>
    </div>
  );
}
