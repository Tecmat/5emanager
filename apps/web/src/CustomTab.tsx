import { useState } from 'react';
import {
  ABILITIES,
  addCustomArmor,
  addCustomClass,
  addCustomEnemy,
  addCustomFeat,
  addCustomRace,
  addCustomSpell,
  addCustomSubclass,
  addCustomWeapon,
  createCharacter,
  exportCustomContent,
  loadData,
  simulateTo20,
  totalLevel,
  type Ability,
  type AttackDef,
  type School,
} from '@dnd5e/core';
import { parseDice } from '@dnd5e/core';
import { useStore, persistCustom } from './store.js';

const SCHOOLS: School[] = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];

type Kind = 'spell' | 'weapon' | 'armor' | 'enemy' | 'feat' | 'race' | 'subclass' | 'class';

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

import SrdEditorCard from './SrdEditorCard.js';

export default function CustomTab() {
  const { reg, reloadCustom, t, tf } = useStore();
  const [kind, setKind] = useState<Kind>('spell');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [simResults, setSimResults] = useState<{ classId: string; name: string; ok: boolean; detail: string }[] | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  /** valida tutte le classi del registro simulando un PG fino al livello 20 */
  const runSimulation = () => {
    setSimRunning(true);
    setSimResults(null);
    try {
      const scores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
      const out: { classId: string; name: string; ok: boolean; detail: string }[] = [];
      for (const cls of reg.classes.values()) {
        const created = createCharacter({ name: 'Sim', raceId: 'human', classId: cls.id, abilityScores: { ...scores } }, reg);
        if (!created.character) {
          out.push({ classId: cls.id, name: cls.name, ok: false, detail: created.errors.join('; ') });
          continue;
        }
        const sim = simulateTo20(created.character, reg);
        const lvl = totalLevel(sim.character);
        out.push({
          classId: cls.id,
          name: cls.name,
          ok: sim.errors.length === 0 && lvl === 20,
          detail: sim.errors.length ? sim.errors.join(' | ') : `liv ${lvl} OK`,
        });
      }
      setSimResults(out);
    } finally {
      setSimRunning(false);
    }
  };

  const [spell, setSpell] = useState({ id: '', name: '', level: 0, school: 'evocation' as School, castingTime: '1 azione', range: '9 m', components: 'V, S', duration: 'Istantanea', description: '', damage: '', classes: 'wizard', ritual: false, concentration: false });
  const [weapon, setWeapon] = useState({ id: '', name: '', category: 'martial' as 'simple' | 'martial', type: 'melee' as 'melee' | 'ranged', damage: '1d8', damageType: 'taglio', properties: '', weight: 3, costGp: 15, bonus: 0 });
  const [armor, setArmor] = useState({ id: '', name: '', category: 'light' as 'light' | 'medium' | 'heavy' | 'shield', ac: 12, maxDex: '', weight: 10, costGp: 10 });
  const [enemy, setEnemy] = useState({ id: '', name: '', hp: 10, ac: 12, speed: 30, cr: '', str: '', dex: '', con: '', int: '', wis: '', cha: '' });
  const [attacks, setAttacks] = useState<AttackDef[]>([{ name: 'Artiglio', bonus: 4, dice: '1d6+2', type: 'taglio' }]);
  const [feat, setFeat] = useState({ id: '', name: '', description: '', effects: '+2 CA\nadvantage: saves vs magic' });
  const [race, setRace] = useState({ id: '', name: '', speed: 30, str: '', dex: '', con: '', int: '', wis: '', cha: '', traits: '' });
  const [subclass, setSubclass] = useState({ id: '', classId: '', name: '', features: '{\n  "3": [ { "id": "f1", "name": "...", "description": "...", "effects": [] } ]\n}' });
  const [cls, setCls] = useState({ id: '', name: '', hitDie: 8, primaryAbility: 'str', savingThrows: 'str,con', armorProficiencies: '', weaponProficiencies: 'simple, martial', toolProficiencies: '', skillChoose: 2, skillFrom: 'athletics, intimidation' });
  const [clsFeatures, setClsFeatures] = useState('{\n  "1": [ { "id": "f1", "name": "...", "description": "...", "effects": [] } ]\n}');

  const save = () => persistCustom(exportCustomContent(reg));

  const done = (r: { ok: boolean; errors: string[] }) => {
    if (r.ok) {
      save();
      reloadCustom();
      setMsg({ ok: true, text: 'Contenuto aggiunto e salvato.' });
    } else {
      setMsg({ ok: false, text: r.errors.join('\n') });
    }
  };

  const submit = () => {
    setMsg(null);
    if (kind === 'spell') {
      done(addCustomSpell(reg, {
        id: spell.id, name: spell.name, level: spell.level, school: spell.school,
        castingTime: spell.castingTime, range: spell.range, components: spell.components,
        duration: spell.duration, description: spell.description,
        damage: spell.damage || undefined, ritual: spell.ritual || undefined, concentration: spell.concentration || undefined,
        classes: splitList(spell.classes), source: 'custom',
      }));
    } else if (kind === 'weapon') {
      done(addCustomWeapon(reg, {
        id: weapon.id, name: weapon.name, category: weapon.category, type: weapon.type,
        damage: weapon.damage, damageType: weapon.damageType,
        properties: splitList(weapon.properties),
        weight: weapon.weight, cost: { value: weapon.costGp, unit: 'gp' },
        bonus: weapon.bonus || undefined, source: 'custom',
      }));
    } else if (kind === 'armor') {
      done(addCustomArmor(reg, {
        id: armor.id, name: armor.name, category: armor.category, ac: armor.ac,
        maxDex: armor.maxDex === '' ? undefined : Number(armor.maxDex),
        weight: armor.weight, cost: { value: armor.costGp, unit: 'gp' }, source: 'custom',
      }));
    } else if (kind === 'enemy') {
      const abilities: Partial<Record<Ability, number>> = {};
      for (const ab of ABILITIES) {
        const v = (enemy as Record<string, string | number>)[ab];
        if (v !== '' && v !== undefined && !Number.isNaN(Number(v))) abilities[ab] = Number(v);
      }
      done(addCustomEnemy(reg, {
        id: enemy.id, name: enemy.name, hp: enemy.hp, ac: enemy.ac, speed: enemy.speed,
        cr: enemy.cr || undefined,
        attacks: attacks.filter((a) => a.name && a.dice),
        abilities: Object.keys(abilities).length ? abilities : undefined,
        source: 'custom',
      }));
    } else if (kind === 'feat') {
      done(addCustomFeat(reg, {
        id: feat.id, name: feat.name, description: feat.description,
        effects: feat.effects.split('\n').map((l) => l.trim()).filter(Boolean).map((text) => ({ type: 'effect' as const, text })),
        source: 'custom',
      }));
    } else if (kind === 'race') {
      const bonuses: Partial<Record<Ability, number>> = {};
      for (const ab of ABILITIES) {
        const v = (race as Record<string, string | number>)[ab];
        if (v !== '' && v !== undefined && !Number.isNaN(Number(v))) bonuses[ab] = Number(v);
      }
      const traits = race.traits.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
        const [name, ...rest] = l.split(':');
        return { id: `t${i}`, name: name.trim(), description: rest.join(':').trim() || name.trim() };
      });
      done(addCustomRace(reg, {
        id: race.id, name: race.name, speed: race.speed,
        abilityBonuses: bonuses, traits, subraces: [], source: 'custom',
      }));
    } else if (kind === 'subclass') {
      try {
        done(addCustomSubclass(reg, { id: subclass.id, classId: subclass.classId, name: subclass.name, features: JSON.parse(subclass.features), source: 'custom' }));
      } catch (e) {
        setMsg({ ok: false, text: 'JSON non valido: ' + (e as Error).message });
      }
    } else {
      try {
        done(addCustomClass(reg, {
          id: cls.id, name: cls.name, hitDie: cls.hitDie as 6 | 8 | 10 | 12,
          primaryAbility: splitList(cls.primaryAbility) as Ability[],
          savingThrows: splitList(cls.savingThrows) as Ability[],
          armorProficiencies: splitList(cls.armorProficiencies),
          weaponProficiencies: splitList(cls.weaponProficiencies),
          toolProficiencies: splitList(cls.toolProficiencies),
          skillChoices: { choose: cls.skillChoose, from: splitList(cls.skillFrom) },
          features: JSON.parse(clsFeatures),
          source: 'custom',
        }));
      } catch (e) {
        setMsg({ ok: false, text: 'JSON features non valido: ' + (e as Error).message });
      }
    }
  };

  const exportPack = () => {
    const blob = new Blob([JSON.stringify(exportCustomContent(reg), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'contenuti-custom.5epack.json';
    a.click();
  };

  const importPack = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      try {
        loadData(reg, JSON.parse(t));
        save();
        reloadCustom();
        setMsg({ ok: true, text: 'Pacchetto .5epack importato.' });
      } catch (err) {
        setMsg({ ok: false, text: 'File non valido: ' + (err as Error).message });
      }
    });
  };

  // anteprima progressione per la classe (dal JSON delle features)
  let clsPreview: [number, string[]][] = [];
  try {
    const f = JSON.parse(clsFeatures) as Record<string, { name?: string }[]>;
    clsPreview = Object.entries(f)
      .map(([l, arr]) => [Number(l), (arr ?? []).map((x) => x?.name ?? '?')] as [number, string[]])
      .filter(([l]) => l >= 1 && l <= 20)
      .sort((a, b) => a[0] - b[0]);
  } catch { /* JSON non valido: niente anteprima */ }

  const customs = {
    incantesimi: [...reg.spells.values()].filter((s) => s.source === 'custom'),
    armi: [...reg.weapons.values()].filter((w) => w.source === 'custom'),
    armature: [...reg.armors.values()].filter((a) => a.source === 'custom'),
    nemici: [...reg.enemies.values()].filter((x) => x.source === 'custom'),
    talenti: [...reg.feats.values()].filter((x) => x.source === 'custom'),
    razze: [...reg.races.values()].filter((x) => x.source === 'custom'),
    archetipi: [...reg.subclasses.values()].filter((x) => x.source === 'custom'),
    classi: [...reg.classes.values()].filter((c) => c.source === 'custom'),
  };

  const tagList = (arr: { id: string; name: string }[]) =>
    arr.length ? arr.map((x) => <span key={x.id} className="tag custom">{x.name}</span>) : <span className="muted">{t('cu.none', 'nessuno')}</span>;

  return (
    <div className="grid cols2">
      <SrdEditorCard />
      <div className="card">
        <h3>{t('cu.add', 'Aggiungi contenuto custom')}</h3>
        <label>{t('cu.type', 'Tipo')}</label>
        <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setMsg(null); }}>
          <option value="spell">{t('cu.k.spell', 'Incantesimo')}</option>
          <option value="weapon">{t('cu.k.weapon', 'Arma')}</option>
          <option value="armor">{t('cu.k.armor', 'Armatura/Scudo')}</option>
          <option value="enemy">{t('cu.k.enemy', 'Nemico (statblock)')}</option>
          <option value="feat">{t('cu.k.feat', 'Talento (effetti DSL)')}</option>
          <option value="race">{t('cu.k.race', 'Razza')}</option>
          <option value="subclass">{t('cu.k.subclass', 'Archetipo')}</option>
          <option value="class">{t('cu.k.class', 'Classe (form strutturato)')}</option>
        </select>

        {kind === 'spell' && (
          <>
            <label>{t('cu.id', 'ID')} ({t('cu.idPh', 'es. dardo-del-drago')})</label><input value={spell.id} onChange={(e) => setSpell({ ...spell, id: e.target.value })} />
            <label>{t('cu.name', 'Nome')}</label><input value={spell.name} onChange={(e) => setSpell({ ...spell, name: e.target.value })} />
            <div className="grid cols2">
              <div><label>{t('cu.level', 'Livello (0-9)')}</label><input type="number" min={0} max={9} value={spell.level} onChange={(e) => setSpell({ ...spell, level: Number(e.target.value) })} /></div>
              <div><label>{t('cu.school', 'Scuola')}</label><select value={spell.school} onChange={(e) => setSpell({ ...spell, school: e.target.value as School })}>{SCHOOLS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              <div><label>{t('cu.castingTime', 'Tempo')}</label><input value={spell.castingTime} onChange={(e) => setSpell({ ...spell, castingTime: e.target.value })} /></div>
              <div><label>{t('cu.range', 'Portata')}</label><input value={spell.range} onChange={(e) => setSpell({ ...spell, range: e.target.value })} /></div>
              <div><label>{t('cu.components', 'Componenti')}</label><input value={spell.components} onChange={(e) => setSpell({ ...spell, components: e.target.value })} placeholder={t('cu.componentsPh', 'V, S, M (un diamante da 50 mo)')} /></div>
              <div><label>{t('cu.duration', 'Durata')}</label><input value={spell.duration} onChange={(e) => setSpell({ ...spell, duration: e.target.value })} /></div>
              <div><label>{t('cu.damage', 'Dado danno (opz.)')}</label><input value={spell.damage} onChange={(e) => setSpell({ ...spell, damage: e.target.value })} placeholder="3d6" />
                {spell.damage && (() => {
                  const p = parseDice(spell.damage);
                  if (!p) return null;
                  const avg = p.dice.reduce((sum, d) => sum + d.sign * d.count * ((d.faces + 1) / 2), 0) + p.mod;
                  const baseline = [5.5, 10.5, 14, 18, 21, 24.5, 28, 31.5, 35, 38.5][spell.level] ?? 0;
                  return <div className="muted" style={{ fontSize: 11 }}>{tf('cu.dmgAvg', 'danno medio {avg} · baseline liv {lvl}: {base}', { avg: Math.round(avg * 10) / 10, lvl: spell.level, base: baseline })}</div>;
                })()}
              </div>
              <div><label>{t('cu.classes', 'Classi (virgola)')}</label><input value={spell.classes} onChange={(e) => setSpell({ ...spell, classes: e.target.value })} /></div>
            </div>
            <label className="row"><input type="checkbox" checked={spell.ritual} onChange={(e) => setSpell({ ...spell, ritual: e.target.checked })} style={{ width: 'auto' }} /> Rituale (lanciabile senza slot)</label>
            <label className="row"><input type="checkbox" checked={spell.concentration} onChange={(e) => setSpell({ ...spell, concentration: e.target.checked })} style={{ width: 'auto' }} /> Concentrazione</label>
            <label>{t('cu.description', 'Descrizione')}</label><textarea rows={3} value={spell.description} onChange={(e) => setSpell({ ...spell, description: e.target.value })} />
          </>
        )}

        {kind === 'weapon' && (
          <>
            <label>{t('cu.id', 'ID')}</label><input value={weapon.id} onChange={(e) => setWeapon({ ...weapon, id: e.target.value })} />
            <label>{t('cu.name', 'Nome')}</label><input value={weapon.name} onChange={(e) => setWeapon({ ...weapon, name: e.target.value })} />
            <div className="grid cols2">
              <div><label>{t('cu.category', 'Categoria')}</label><select value={weapon.category} onChange={(e) => setWeapon({ ...weapon, category: e.target.value as 'simple' | 'martial' })}><option value="simple">simple</option><option value="martial">martial</option></select></div>
              <div><label>{t('cu.meleeRanged', 'Mischia/distanza')}</label><select value={weapon.type} onChange={(e) => setWeapon({ ...weapon, type: e.target.value as 'melee' | 'ranged' })}><option value="melee">melee</option><option value="ranged">ranged</option></select></div>
              <div><label>{t('cu.damageDie', 'Dado danno')}</label><input value={weapon.damage} onChange={(e) => setWeapon({ ...weapon, damage: e.target.value })} placeholder="1d8" /></div>
              <div><label>{t('cu.damageType', 'Tipo danno')}</label><input value={weapon.damageType} onChange={(e) => setWeapon({ ...weapon, damageType: e.target.value })} /></div>
              <div><label>{t('cu.properties', 'Proprietà (virgola)')}</label><input value={weapon.properties} onChange={(e) => setWeapon({ ...weapon, properties: e.target.value })} placeholder={t('cu.propertiesPh', 'finesse, leggera')} /></div>
              <div><label>{t('inv.weightL', 'Peso')}</label><input type="number" value={weapon.weight} onChange={(e) => setWeapon({ ...weapon, weight: Number(e.target.value) })} /></div>
              <div><label>{t('cu.cost', 'Costo (MO)')}</label><input type="number" value={weapon.costGp} onChange={(e) => setWeapon({ ...weapon, costGp: Number(e.target.value) })} /></div>
              <div><label>{t('cu.magicBonus', 'Bonus magico (0 = no)')}</label><input type="number" value={weapon.bonus} onChange={(e) => setWeapon({ ...weapon, bonus: Number(e.target.value) })} /></div>
            </div>
          </>
        )}

        {kind === 'armor' && (
          <>
            <label>{t('cu.id', 'ID')}</label><input value={armor.id} onChange={(e) => setArmor({ ...armor, id: e.target.value })} />
            <label>{t('cu.name', 'Nome')}</label><input value={armor.name} onChange={(e) => setArmor({ ...armor, name: e.target.value })} />
            <div className="grid cols2">
              <div><label>{t('cu.category', 'Categoria')}</label><select value={armor.category} onChange={(e) => setArmor({ ...armor, category: e.target.value as typeof armor.category })}><option value="light">leggera</option><option value="medium">media</option><option value="heavy">pesante</option><option value="shield">scudo</option></select></div>
              <div><label>{t('cu.ac', 'CA')}</label><input type="number" value={armor.ac} onChange={(e) => setArmor({ ...armor, ac: Number(e.target.value) })} /></div>
              <div><label>{t('cu.maxDex', 'Des max (vuoto = illimitato)')}</label><input value={armor.maxDex} onChange={(e) => setArmor({ ...armor, maxDex: e.target.value })} /></div>
              <div><label>{t('inv.weightL', 'Peso')}</label><input type="number" value={armor.weight} onChange={(e) => setArmor({ ...armor, weight: Number(e.target.value) })} /></div>
              <div><label>{t('cu.cost', 'Costo (MO)')}</label><input type="number" value={armor.costGp} onChange={(e) => setArmor({ ...armor, costGp: Number(e.target.value) })} /></div>
            </div>
          </>
        )}

        {kind === 'enemy' && (
          <>
            <label>{t('cu.id', 'ID')}</label><input value={enemy.id} onChange={(e) => setEnemy({ ...enemy, id: e.target.value })} />
            <label>{t('cu.name', 'Nome')}</label><input value={enemy.name} onChange={(e) => setEnemy({ ...enemy, name: e.target.value })} />
            <div className="grid cols3">
              <div><label>{t('cu.hp', 'PF')}</label><input type="number" value={enemy.hp} onChange={(e) => setEnemy({ ...enemy, hp: Number(e.target.value) })} /></div>
              <div><label>{t('cu.ac', 'CA')}</label><input type="number" value={enemy.ac} onChange={(e) => setEnemy({ ...enemy, ac: Number(e.target.value) })} /></div>
              <div><label>{t('cu.speed', 'Velocità')}</label><input type="number" value={enemy.speed} onChange={(e) => setEnemy({ ...enemy, speed: Number(e.target.value) })} /></div>
              <div><label>{t('cu.cr', 'CR (opz.)')}</label><input value={enemy.cr} onChange={(e) => setEnemy({ ...enemy, cr: e.target.value })} placeholder={t('cu.crPh', '1/4')} /></div>
            </div>
            <label>{t('cu.abilities', 'Caratteristiche (opz., vuoto = 10)')}</label>
            <div className="grid cols3">
              {ABILITIES.map((ab) => (
                <div key={ab}><label>{ab.toUpperCase()}</label><input type="number" value={(enemy as Record<string, string | number>)[ab]} onChange={(e) => setEnemy({ ...enemy, [ab]: e.target.value })} /></div>
              ))}
            </div>
            <label>{t('cu.attacks', 'Attacchi')}</label>
            {attacks.map((a, i) => (
              <div key={i} className="row" style={{ marginBottom: 4 }}>
                <input value={a.name} onChange={(e) => setAttacks(attacks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Nome" style={{ width: 110 }} />
                <input type="number" value={a.bonus} onChange={(e) => setAttacks(attacks.map((x, j) => (j === i ? { ...x, bonus: Number(e.target.value) } : x)))} style={{ width: 60 }} title="Bonus" />
                <input value={a.dice} onChange={(e) => setAttacks(attacks.map((x, j) => (j === i ? { ...x, dice: e.target.value } : x)))} placeholder="1d6+3" style={{ width: 80 }} />
                <input value={a.type ?? ''} onChange={(e) => setAttacks(attacks.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} placeholder="tipo" style={{ width: 80 }} />
                <button className="danger" onClick={() => setAttacks(attacks.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button onClick={() => setAttacks([...attacks, { name: '', bonus: 0, dice: '1d6', type: '' }])}>+ attacco</button>
          </>
        )}

        {kind === 'feat' && (
          <>
            <label>{t('cu.id', 'ID')}</label><input value={feat.id} onChange={(e) => setFeat({ ...feat, id: e.target.value })} />
            <label>{t('cu.name', 'Nome')}</label><input value={feat.name} onChange={(e) => setFeat({ ...feat, name: e.target.value })} />
            <label>{t('cu.description', 'Descrizione')}</label><textarea rows={2} value={feat.description} onChange={(e) => setFeat({ ...feat, description: e.target.value })} />
            <label>Effetti (mini-DSL, uno per riga)</label>
            <textarea rows={4} value={feat.effects} onChange={(e) => setFeat({ ...feat, effects: e.target.value })} placeholder={'+2 CA\nadvantage: saves vs magic\n+1d6 fire damage\nproficiency: skill stealth'} />
            <div className="muted">Forme: +N CA · advantage/disadvantage: attacks|saves|skills [vs X] · +NdX tipo damage · proficiency: skill/weapon/armor X · resistance/immunity/vulnerability: tipo · speed +N · darkvision N · max hp +N per level</div>
          </>
        )}

        {kind === 'race' && (
          <>
            <label>{t('cu.id', 'ID')}</label><input value={race.id} onChange={(e) => setRace({ ...race, id: e.target.value })} />
            <label>{t('cu.name', 'Nome')}</label><input value={race.name} onChange={(e) => setRace({ ...race, name: e.target.value })} />
            <div className="grid cols2">
              <div><label>Velocità (piedi)</label><input type="number" value={race.speed} onChange={(e) => setRace({ ...race, speed: Number(e.target.value) })} /></div>
            </div>
            <label>Bonus caratteristiche (vuoto = 0)</label>
            <div className="grid cols3">
              {ABILITIES.map((ab) => (
                <div key={ab}><label>{ab.toUpperCase()}</label><input type="number" value={(race as Record<string, string | number>)[ab]} onChange={(e) => setRace({ ...race, [ab]: e.target.value })} /></div>
              ))}
            </div>
            <label>Tratti (una riga "Nome: descrizione")</label>
            <textarea rows={3} value={race.traits} onChange={(e) => setRace({ ...race, traits: e.target.value })} placeholder={'Scurovisione: vedi a 18 m al buio\nResistenza: resistance: poison'} />
          </>
        )}

        {kind === 'subclass' && (
          <>
            <label>{t('cu.id', 'ID')}</label><input value={subclass.id} onChange={(e) => setSubclass({ ...subclass, id: e.target.value })} />
            <label>Classe</label>
            <select value={subclass.classId} onChange={(e) => setSubclass({ ...subclass, classId: e.target.value })}>
              <option value="">(scegli)</option>
              {[...reg.classes.values()].map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label>{t('cu.name', 'Nome')}</label><input value={subclass.name} onChange={(e) => setSubclass({ ...subclass, name: e.target.value })} />
            <label>Features JSON (livelli → array feature)</label>
            <textarea rows={8} value={subclass.features} onChange={(e) => setSubclass({ ...subclass, features: e.target.value })} />
          </>
        )}

        {kind === 'class' && (
          <>
            <label>{t('cu.id', 'ID')}</label><input value={cls.id} onChange={(e) => setCls({ ...cls, id: e.target.value })} />
            <label>{t('cu.name', 'Nome')}</label><input value={cls.name} onChange={(e) => setCls({ ...cls, name: e.target.value })} />
            <div className="grid cols2">
              <div><label>Dado vita</label><select value={cls.hitDie} onChange={(e) => setCls({ ...cls, hitDie: Number(e.target.value) })}>{[6, 8, 10, 12].map((d) => <option key={d} value={d}>d{d}</option>)}</select></div>
              <div><label>Caratteristica principale (virgola)</label><input value={cls.primaryAbility} onChange={(e) => setCls({ ...cls, primaryAbility: e.target.value })} /></div>
              <div><label>TS di classe (2, virgola)</label><input value={cls.savingThrows} onChange={(e) => setCls({ ...cls, savingThrows: e.target.value })} /></div>
              <div><label>Competenze skill (scegli)</label><input type="number" value={cls.skillChoose} onChange={(e) => setCls({ ...cls, skillChoose: Number(e.target.value) })} /></div>
              <div><label>Da quali skill (virgola)</label><input value={cls.skillFrom} onChange={(e) => setCls({ ...cls, skillFrom: e.target.value })} /></div>
              <div><label>Armature (virgola)</label><input value={cls.armorProficiencies} onChange={(e) => setCls({ ...cls, armorProficiencies: e.target.value })} placeholder="light, medium, shields" /></div>
              <div><label>Armi (virgola)</label><input value={cls.weaponProficiencies} onChange={(e) => setCls({ ...cls, weaponProficiencies: e.target.value })} /></div>
              <div><label>Strumenti (virgola)</label><input value={cls.toolProficiencies} onChange={(e) => setCls({ ...cls, toolProficiencies: e.target.value })} /></div>
            </div>
            <label>Features JSON (livelli 1-20 → array feature con effects)</label>
            <textarea rows={8} value={clsFeatures} onChange={(e) => setClsFeatures(e.target.value)} />
            {clsPreview.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <label>Anteprima progressione</label>
                <table>
                  <tbody>
                    {clsPreview.map(([lvl, names]) => (
                      <tr key={lvl}><td><b>{lvl}</b></td><td className="muted">{names.join(', ') || '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {msg && <div className={msg.ok ? 'ok' : 'error'} style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{msg.text}</div>}
        <div style={{ marginTop: 10 }}><button className="primary" onClick={submit}>{t('cu.save', 'Salva')}</button></div>
      </div>

      <div className="card">
        <h3>{t('cu.simTitle', '🧪 Validazione: simula ogni classe fino al 20')}</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          {t('cu.simHint', 'Crea un PG di prova per ogni classe (incluse quelle custom) e prova a salire automaticamente fino al livello 20: segnala classi con regole rotte (archetipi mancanti, ASI impossibili, XP insufficienti…).')}
        </div>
        <button className="primary" onClick={runSimulation} disabled={simRunning}>
          {simRunning ? t('cu.simRunning', 'Simulo…') : t('cu.simRun', '▶ Avvia simulazione (12+ classi)')}
        </button>
        {simResults && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <div className={simResults.every((r) => r.ok) ? 'ok' : 'error'} style={{ marginBottom: 4 }}>
              {simResults.filter((r) => r.ok).length}/{simResults.length} {t('cu.simOk', 'classi OK')}
            </div>
            {simResults.map((r) => (
              <div key={r.classId} className={r.ok ? 'ok' : 'error'} style={{ marginTop: 2 }}>
                {r.ok ? '✅' : '❌'} <b>{r.name}</b> — {r.detail}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>{t('cu.listTitle', 'I tuoi contenuti custom')}</h3>
        <div><b>{t('cu.lSpells', 'Incantesimi:')}</b> {tagList(customs.incantesimi)}</div>
        <div style={{ marginTop: 6 }}><b>{t('cu.lWeapons', 'Armi:')}</b> {tagList(customs.armi)}</div>
        <div style={{ marginTop: 6 }}><b>{t('cu.lArmors', 'Armature:')}</b> {tagList(customs.armature)}</div>
        <div style={{ marginTop: 6 }}><b>{t('cu.lEnemies', 'Nemici:')}</b> {tagList(customs.nemici)}</div>
        <div style={{ marginTop: 6 }}><b>{t('cu.lFeats', 'Talenti:')}</b> {tagList(customs.talenti)}</div>
        <div style={{ marginTop: 6 }}><b>{t('cu.lRaces', 'Razze:')}</b> {tagList(customs.razze)}</div>
        <div style={{ marginTop: 6 }}><b>{t('cu.lSubs', 'Archetipi:')}</b> {tagList(customs.archetipi)}</div>
        <div style={{ marginTop: 6 }}><b>{t('cu.lClasses', 'Classi:')}</b> {tagList(customs.classi)}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={exportPack}>{t('cu.exportPack', '📦 Esporta .5epack')}</button>
          <label style={{ margin: 0 }} className="row">
            <input type="file" accept="application/json,.json" onChange={importPack} style={{ width: 'auto' }} /> {t('cu.importPack', 'Importa .5epack')}
          </label>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>{t('cu.packHint', 'I custom sono salvati in locale e si possono condividere come file .5epack (JSON).')}</div>
      </div>
    </div>
  );
}
