import { useMemo, useRef, useState } from 'react';
import {
  ABILITIES,
  addXp,
  armorClass,
  canLevelUp,
  carryingCapacity,
  damage,
  EXHAUSTION_MAX,
  exhaustionEffects,
  heal,
  initiativeBonus,
  isDead,
  levelForXp,
  logJournal,
  longRest,
  maxHp,
  migrateCharacter,
  passivePerception,
  proficiencyBonus,
  recordDeathSave,
  savingThrowBonus,
  setExhaustion,
  shortRest,
  skillBonus,
  spellcastingInfoAll,
  speedOf,
  totalLevel,
  xpForLevel,
  XP_TABLE,
  type Ability,
  type Character,
} from '@dnd5e/core';
import { SKILLS } from '@dnd5e/core';
import { CONDITIONS, DEFAULT_HOUSE_RULES, addCondition, removeCondition, unlockedMechanics, type HouseRules } from '@dnd5e/core';
import { CUSTOM_KEY, useStore } from './store.js';
import { loadJSON, saveJSON } from './storage.js';
import { sha256Hex } from './netStore.js';
import LevelUpDialog from './LevelUpDialog.js';
import DiceRoller from './DiceRoller.js';
import { printSheet } from './pdf.js';
import { detectPlatform } from './update.js';

const RULE_LABELS: [keyof HouseRules, string][] = [
  ['bypassSpellLimit', 'Ignora limite incantesimi appresi'],
  ['bypassAsiCap', 'Ignora cap 20 delle caratteristiche'],
  ['bypassAttunementLimit', 'Ignora sintonizzazione max 3'],
  ['bypassXpCheck', 'Level-up senza requisiti XP'],
  ['bypassLevelCap', 'Supera il livello 20'],
];

const ABILITY_IT: Record<Ability, string> = { str: 'Forza', dex: 'Destrezza', con: 'Costituzione', int: 'Intelligenza', wis: 'Saggezza', cha: 'Carisma' };

const EXH_LABELS = [
  'nessuno',
  'svantaggio alle prove di caratteristica',
  'velocità dimezzata',
  'svantaggio a attacchi e tiri salvezza',
  'PF massimi dimezzati',
  'velocità 0',
  'MORTE',
];

function fmt(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

const LOCK_KEY = 'dnd5e.lock.v1';

interface LockRec {
  enabled: boolean;
  hash: string;
}

function loadLock(): LockRec {
  try {
    const r = JSON.parse(localStorage.getItem(LOCK_KEY) ?? '{}') as Partial<LockRec>;
    return { enabled: !!r.enabled, hash: r.hash ?? '' };
  } catch {
    return { enabled: false, hash: '' };
  }
}

export default function Overview({ editing = false }: { editing?: boolean }) {
  const { reg, char, setChar, createSheet, importSheets, sheets, resetChar, reloadCustom, t, tf } = useStore();
  const [lock, setLock] = useState<LockRec>(loadLock);

  const editField = <K extends keyof Character>(key: K, value: Character[K]) => {
    if (!char) return;
    setChar({ ...char, [key]: value, updatedAt: new Date().toISOString() });
  };


  const setupLock = async () => {
    const pw1 = prompt('Scegli la password locale per bloccare l\'app (min 4 caratteri):');
    if (!pw1 || pw1.length < 4) return;
    const pw2 = prompt('Ripeti la password:');
    if (pw2 !== pw1) { alert('Le password non coincidono'); return; }
    const hash = await sha256Hex(pw1);
    const rec = { enabled: true, hash };
    localStorage.setItem(LOCK_KEY, JSON.stringify(rec));
    setLock(rec);
  };

  const changeLock = async () => {
    const old = prompt('Password attuale:');
    if (!old) return;
    if ((await sha256Hex(old)) !== lock.hash) { alert('Password errata'); return; }
    await setupLock();
  };

  const disableLock = async () => {
    const old = prompt('Password attuale (per disabilitare il blocco):');
    if (!old) return;
    if ((await sha256Hex(old)) !== lock.hash) { alert('Password errata'); return; }
    const rec = { enabled: false, hash: '' };
    localStorage.setItem(LOCK_KEY, JSON.stringify(rec));
    setLock(rec);
  };
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [dmg, setDmg] = useState(0);
  const [healAmt, setHealAmt] = useState(0);
  const [restDice, setRestDice] = useState(1);
  const [xpAmt, setXpAmt] = useState(300);
  const portraitRef = useRef<HTMLInputElement>(null);
  const [journalText, setJournalText] = useState('');

  const addJournalEntry = () => {
    const txt = journalText.trim();
    if (!txt || !char) return;
    setChar(logJournal(char, txt));
    setJournalText('');
  };

  const uploadPortrait = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert(t('ov.alertImg', 'Scegli un file immagine (png, jpg, webp...)'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (!char) return;
      const max = 256;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(img.src);
      setChar({ ...char, portrait: dataUrl, updatedAt: new Date().toISOString() });
    };
    img.onerror = () => alert(t('ov.alertImgBad', 'Immagine non valida'));
    img.src = URL.createObjectURL(file);
  };

  if (!char) return null;
  const level = totalLevel(char);
  const pb = proficiencyBonus(level);
  const hpMax = maxHp(char, reg);
  const hpPct = Math.max(0, Math.min(100, (char.hp.current / Math.max(1, hpMax)) * 100));
  const { ac, breakdown } = armorClass(char, reg);
  const cap = carryingCapacity(char);
  const race = reg.races.get(char.raceId);
  const bgName = char.background ? (reg.backgrounds.get(char.background)?.name ?? char.background) : '';
  const subrace = race?.subraces.find((s) => s.id === char.subraceId);
  const classNames = char.classLevels.map((cl) => {
    const c = reg.classes.get(cl.classId);
    const sub = cl.subclassId ? reg.subclasses.get(cl.subclassId) : undefined;
    return `${c?.name ?? cl.classId} ${cl.level}${sub ? ` (${sub.name})` : ''}`;
  });

  const xpNext = level < 20 ? xpForLevel(level + 1) : null;
  const xpProgress = xpNext ? Math.min(100, ((char.xp - xpForLevel(level)) / (xpNext - xpForLevel(level))) * 100) : 100;

  const features = useMemo(() => {
    const out: { name: string; source: string; description: string }[] = [];
    for (const cl of char.classLevels) {
      const cls = reg.classes.get(cl.classId);
      if (!cls) continue;
      for (let l = 1; l <= cl.level; l++) {
        for (const f of cls.features[l] ?? []) out.push({ name: f.name, source: `${cls.name} ${l}`, description: f.description });
      }
      const sub = cl.subclassId ? reg.subclasses.get(cl.subclassId) : undefined;
      if (sub) {
        for (let l = 1; l <= cl.level; l++) {
          for (const f of sub.features[l] ?? []) out.push({ name: f.name, source: `${sub.name} ${l}`, description: f.description });
        }
      }
    }
    return out;
  }, [char, reg]);

  const exportChar = async () => {
    const content = JSON.stringify(char, null, 2);
    const name = `${char.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    // su desktop (Tauri/AppImage) i download via blob-anchor sono bloccati dalla WebView:
    // si salva il file con un comando Tauri (Downloads o HOME)
    if (detectPlatform() === 'desktop') {
      const { invoke } = await import('@tauri-apps/api/core');
      const p = await invoke('save_text_file', { name, content });
      alert(tf('ov.savedTo', 'Salvato in {p}', { p: String(p) }));
      return;
    }
    const blob = new Blob([content], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  };

  const importChar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        createSheet(migrateCharacter(JSON.parse(txt) as Character));
      } catch {
        alert(t('ov.alertJson', 'File JSON non valido'));
      }
    });
  };

  const exportLibrary = async () => {
    let custom: unknown = {};
    try { custom = (await loadJSON(CUSTOM_KEY)) ?? {}; } catch { /* vuoto */ }
    const data = {
      app: '5emanager', version: 1, exportedAt: new Date().toISOString(),
      sheets, custom,
    };
    const content = JSON.stringify(data, null, 2);
    if (detectPlatform() === 'desktop') {
      const { invoke } = await import('@tauri-apps/api/core');
      const p = await invoke('save_text_file', { name: '5emanager-libreria.json', content });
      alert(tf('ov.savedTo', 'Salvato in {p}', { p: String(p) }));
      return;
    }
    const blob = new Blob([content], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '5emanager-libreria.json';
    a.click();
  };

  const importLibrary = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(async (txt) => {
      try {
        const d = JSON.parse(txt) as { sheets?: Character[]; custom?: Record<string, unknown[]> };
        if (!d || !Array.isArray(d.sheets)) throw new Error('formato non riconosciuto');
        importSheets(d.sheets);
        if (d.custom) {
          // merge dei contenuti custom per id
          const cur = ((await loadJSON(CUSTOM_KEY)) ?? {}) as Record<string, any[]>;
          for (const [k, arr] of Object.entries(d.custom as Record<string, any[]>)) {
            if (!Array.isArray(arr)) continue;
            const map = new Map<string, any>((cur[k] ?? []).map((x: any) => [x.id as string, x]));
            for (const x of arr) if (x && typeof x.id === 'string') map.set(x.id, x);
            cur[k] = [...map.values()];
          }
          saveJSON(CUSTOM_KEY, cur).then(() => reloadCustom());
        }
        alert(tf('ov.alertLibOk', 'Libreria importata: {n} schede{extra}.', { n: d.sheets.length, extra: d.custom ? ' + contenuti custom' : '' }));
      } catch (err) {
        alert(tf('ov.alertLibErr', 'File non valido: {msg}', { msg: (err as Error).message }));
      }
    });
  };

  return (
    <div className="grid">
      <div className="grid cols3">
        <div className="card">
          <h3>{t('ov.character', 'Personaggio')}</h3>
          <div className="row" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
            {char.portrait
              ? <img className="portrait" src={char.portrait} alt={`Ritratto di ${char.name}`} />
              : <div className="portrait-ph">nessun<br />ritratto</div>}
            <div>
              <div className="row">
                <button onClick={() => portraitRef.current?.click()}>📷 {char.portrait ? t('ov.changePortrait', 'Cambia ritratto') : t('ov.uploadPortrait', 'Carica ritratto')}</button>
                {char.portrait && (
                  <button className="danger" onClick={() => setChar({ ...char, portrait: undefined, updatedAt: new Date().toISOString() })}>{t('ov.remove', 'Rimuovi')}</button>
                )}
              </div>
              <input ref={portraitRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadPortrait} />
              <div className="muted" style={{ fontSize: 11, marginTop: 4, maxWidth: 220 }}>
                {t('ov.portraitHint', 'Ridimensionata a 256px e salvata solo in questo browser.')}
              </div>
            </div>
          </div>
          {editing ? (
            <input value={char.name} onChange={(e) => editField('name', e.target.value)} style={{ fontSize: 18, fontWeight: 700 }} />
          ) : (
            <div className="big">{char.name}</div>
          )}
          {editing && (
            <div className="grid cols2" style={{ marginTop: 6 }}>
              <div>
                <label>{t('ov.background', 'Background')}</label>
                <input value={char.background ?? ''} onChange={(e) => editField('background', e.target.value || undefined)} placeholder="Background" />
              </div>
              <div>
                <label>{t('ov.alignment', 'Allineamento')}</label>
                <input value={char.alignment ?? ''} onChange={(e) => editField('alignment', e.target.value || undefined)} placeholder="Allineamento" />
              </div>
            </div>
          )}
          <div className="muted">{[bgName, race?.name, subrace ? `(${subrace.name})` : '', classNames.join(' / ')].filter(Boolean).join(' · ')}</div>
          {editing && (
            <div style={{ marginTop: 6 }}>
              <label>{t('ov.notes', 'Note')}</label>
              <textarea rows={2} value={char.notes ?? ''} onChange={(e) => editField('notes', e.target.value)} style={{ width: '100%' }} />
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <span className="tag">{tf('ov.level', 'Livello {n}', { n: level })}</span>
            {editing ? (
              <span className="tag row" style={{ gap: 4 }}>
                PF <input type="number" value={char.hp.current} onChange={(e) => setChar({ ...char, hp: { ...char.hp, current: Math.max(0, Number(e.target.value)) }, updatedAt: new Date().toISOString() })} style={{ width: 56 }} />/{hpMax}
              </span>
            ) : (
              <span className="tag">{tf('ov.hp', 'PF {cur}/{max}{temp}', { cur: char.hp.current, max: hpMax, temp: char.hp.temp > 0 ? ` (+${char.hp.temp} temp)` : '' })}</span>
            )}
            <span className="tag">{tf('ov.ac', 'CA {ac}', { ac })}</span>
            <span className="tag">{tf('ov.initiative', 'Iniziativa {v}', { v: fmt(initiativeBonus(char)) })}</span>
            <span className="tag">{tf('ov.passivePerception', 'Percezione passiva {v}', { v: passivePerception(char) })}</span>
            <span className="tag">{tf('ov.profBonus', 'Bonus proficiency {v}', { v: fmt(pb) })}</span>
            <button
              className={`tag ${char.inspiration ? 'custom' : ''}`}
              style={{ cursor: 'pointer', background: 'var(--panel2)', color: 'inherit', border: '1px solid var(--border)' }}
              onClick={() => setChar({ ...char, inspiration: !char.inspiration, updatedAt: new Date().toISOString() })}
              title={t('ov.inspTitle', 'Attiva/disattiva ispirazione')}
            >
              ⭐ {char.inspiration ? t('ov.inspirationOn', 'Ispirazione attiva') : t('ov.inspiration', 'Ispirazione')}
            </button>
          </div>
          <div className={`hpbar${hpPct <= 25 ? ' low' : ''}`} style={{ marginTop: 8 }} title={tf('ov.hp', 'PF {cur}/{max}{temp}', { cur: char.hp.current, max: hpMax, temp: '' })}>
            <div style={{ width: `${hpPct}%` }} />
          </div>
          <div className="muted" style={{ marginTop: 6 }} title={breakdown.join('\n')}>CA: {breakdown.join(' · ')}</div>
          {spellcastingInfoAll(char, reg).length > 0 && (
            <div className="row" style={{ marginTop: 6 }}>
              {spellcastingInfoAll(char, reg).map((si) => (
                <span key={si.classId} className="tag" title={tf('ov.spellTagTitle', 'Incantesimi di {cls} (caratteristica {ab})', { cls: reg.classes.get(si.classId)?.name ?? si.classId, ab: si.ability.toUpperCase() })}>
                  {tf('ov.spellTag', '🔮 {cls}: attacco {atk} · CD {dc}', { cls: reg.classes.get(si.classId)?.name ?? si.classId, atk: fmt(si.attackBonus), dc: si.saveDC })}
                </span>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <label style={{ margin: 0 }}>{t('ov.exhaustion', 'Esaurimento')}</label>
            <select value={char.exhaustion ?? 0} onChange={(e) => setChar(setExhaustion(char, Number(e.target.value)))} style={{ width: 'auto' }}>
              {Array.from({ length: EXHAUSTION_MAX + 1 }).map((_, l) => <option key={l} value={l}>{l === 0 ? t('ov.exhNone', '—') : tf('ov.exhLevel', 'liv {n}', { n: l })}</option>)}
            </select>
            <span className="muted">{t('exh.' + Math.min(EXHAUSTION_MAX, char.exhaustion ?? 0), EXH_LABELS[Math.min(EXHAUSTION_MAX, char.exhaustion ?? 0)])}</span>
            <span className="tag">{tf('ov.speed', 'Velocità {v}', { v: speedOf(char, reg) })}</span>
          </div>
          {char.hp.current <= 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <b>{t('ov.deathSaves', 'Tiri della morte')}</b>
              {[0, 1, 2].map((i) => (
                <button key={'s' + i} className={i < (char.deathSaves?.successes ?? 0) ? 'primary' : ''} onClick={() => setChar(recordDeathSave(char, true))} title={t('ov.deathSuccess', 'Successo')}>✓</button>
              ))}
              {[0, 1, 2].map((i) => (
                <button key={'f' + i} className="danger" style={{ opacity: i < (char.deathSaves?.failures ?? 0) ? 1 : 0.45 }} onClick={() => setChar(recordDeathSave(char, false))} title={t('ov.deathFail', 'Fallimento')}>✗</button>
              ))}
              {isDead(char) ? <span className="error">{t('ov.dead', '💀 morto')}</span> : <span className="muted">{t('ov.deathHint', '3 ✓ = risveglio a 1 PF · 3 ✗ = morto')}</span>}
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <input type="number" style={{ width: 70 }} value={dmg} onChange={(e) => setDmg(Number(e.target.value))} />
            <button onClick={() => setChar(damage(char, dmg))}>{t('ov.damage', 'Danni')}</button>
            <input type="number" style={{ width: 70 }} value={healAmt} onChange={(e) => setHealAmt(Number(e.target.value))} />
            <button onClick={() => setChar(heal(char, healAmt, hpMax))}>{t('ov.heal', 'Cura')}</button>
            <button onClick={() => setChar(longRest(char, reg))}>{t('ov.longRest', 'Riposo lungo')}</button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input type="number" min={0} max={Math.max(1, level)} title={t('ov.restDiceTitle', 'Dadi vita da spendere (max = livello)')} style={{ width: 60 }} value={restDice} onChange={(e) => setRestDice(Number(e.target.value))} />
            <button
              title={t('ov.shortRestTitle', 'Riposo breve: spendi dadi vita e curati del tiro + mod Cos per dado')}
              onClick={() => setChar(shortRest(char, reg, restDice).character)}
            >
              {t('ov.shortRest', 'Riposo breve')}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>{tf('ov.hitDice', 'dadi vita: {n} disponibili', { n: Math.max(0, level - 0) })}</span>
          </div>
        </div>

        <div className="card">
          <h3>{t('ov.xp', 'Esperienza')}</h3>
          <div className="row">
            {editing ? (
              <span className="row">
                <input type="number" value={char.xp} onChange={(e) => editField('xp', Math.max(0, Number(e.target.value)))} style={{ width: 90 }} />
                <span className="big">XP</span>
              </span>
            ) : (
              <span className="big">{tf('ov.xpBig', '{n} XP', { n: char.xp })}</span>
            )}
            <span className="muted">{tf('ov.xpLevelLine', 'livello {l}{next}', { l: level, next: xpNext ? tf('ov.xpNext', ' / {n} XP', { n: xpNext }) : t('ov.xpMax', ' (max)') })}</span>
          </div>
          <div className="xpbar"><div style={{ width: `${xpProgress}%` }} /></div>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="number" style={{ width: 90 }} value={xpAmt} onChange={(e) => setXpAmt(Number(e.target.value))} />
            <button onClick={() => setChar(addXp(char, xpAmt))}>{t('ov.addXp', 'Aggiungi XP')}</button>
            <button className="primary" disabled={!canLevelUp(char)} onClick={() => setShowLevelUp(true)}>
              {t('ov.levelUp', 'Sali di livello')}
            </button>
          </div>
          {!canLevelUp(char) && level < 20 && <div className="muted">{tf('ov.needMoreXp', 'Servono {n} XP in più.', { n: xpForLevel(level + 1) - char.xp })}</div>}
          <div className="muted">{tf('ov.xpFromLevel', 'Livello da XP: {n}', { n: levelForXp(char.xp) })}</div>
        </div>

        <div className="card">
          <h3>{t('ov.abilities', 'Caratteristiche')}</h3>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {ABILITIES.map((ab) => (
              <div key={ab} className="abil">
                <div className="muted" style={{ fontSize: 10 }}>{ABILITY_IT[ab]}</div>
                {editing ? (
                  <input
                    type="number" min={1} max={30}
                    className="score" style={{ width: 52, textAlign: 'center' }}
                    value={char.abilityScores[ab]}
                    onChange={(e) => setChar({ ...char, abilityScores: { ...char.abilityScores, [ab]: Math.max(1, Math.min(30, Number(e.target.value))) }, updatedAt: new Date().toISOString() })}
                  />
                ) : (
                  <div className="score">{char.abilityScores[ab]}</div>
                )}
                <div className="mod">{fmt(Math.floor((char.abilityScores[ab] - 10) / 2))}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid cols2">
        <div className="card">
          <h3>{t('ov.saves', 'Tiri Salvezza')}</h3>
          <table>
            <tbody>
              {ABILITIES.map((ab) => (
                <tr key={ab}>
                  <td>{ABILITY_IT[ab]}</td>
                  <td><b>{fmt(savingThrowBonus(char, ab, reg))}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>{t('ov.skills', 'Abilità')}</h3>
          <table>
            <tbody>
              {SKILLS.map((s) => {
                const b = skillBonus(char, s.id);
                const prof = char.proficiency.skills.includes(s.id);
                const exp = char.proficiency.expertise.includes(s.id);
                return (
                  <tr key={s.id}>
                    <td>{s.name} <span className="muted">({s.ability})</span></td>
                    <td><b>{fmt(b)}</b> {exp && <span className="tag custom">{t('ov.expertise', 'espertise')}</span>}{prof && !exp && <span className="tag">{t('ov.prof', 'prof')}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid cols2">
        <DiceRoller />
        <div className="card">
          <h3>🩸 {t('ov.conditions', '🧸 Condizioni attive')}</h3>
          <div>
            {CONDITIONS.map((c) => {
              const on = char.conditions.includes(c.id);
              return (
                <span
                  key={c.id}
                  className={`tag ${on ? 'custom' : ''}`}
                  style={{ cursor: 'pointer' }}
                  title={c.description}
                  onClick={() => setChar(on ? removeCondition(char, c.id) : addCondition(char, c.id))}
                >
                  {c.name}
                </span>
              );
            })}
          </div>
          <div className="muted" style={{ marginTop: 6 }}>{t('ov.conditionsHint', 'Clicca per aggiungere/rimuovere. Le condizioni con svantaggio (avvelenato, spaventato, prono...) sono annotate nel tira-dado.')}</div>
        </div>
      </div>

      <div className="grid cols2">
        <div className="card">
          <h3>⚙️ {t('ov.houseRules', '⚙️ Selettore regole (house-rules: eludi le regole)')}</h3>
          {RULE_LABELS.map(([key, label]) => (
            <div key={key}>
              <label style={{ margin: '6px 0 0', color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={char.houseRules?.[key] ?? false}
                  onChange={() => setChar({ ...char, houseRules: { ...DEFAULT_HOUSE_RULES, ...char.houseRules, [key]: !(char.houseRules?.[key] ?? false) }, updatedAt: new Date().toISOString() })}
                  style={{ width: 'auto', marginRight: 6 }}
                />
                {t('hr.' + key, label)}
              </label>
            </div>
          ))}
          <div className="muted" style={{ marginTop: 8 }}>{t('ov.houseRulesHint', 'Utile per testare o per campagne con regole della casa.')}</div>
        </div>
        <div className="card">
          <h3>🔓 {t('ov.mechanics', '🍓 Meccaniche sbloccate (scalano col livello)')}</h3>
          {unlockedMechanics(char, reg).length === 0 && <div className="muted">Nessuna.</div>}
          {unlockedMechanics(char, reg).map((m) => (
            <div key={m.id} style={{ marginBottom: 6 }}>
              <b>{m.name}</b> <span className="muted">— {m.source}</span>
              <div className="muted">{m.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid cols2">
        <div className="card">
          <h3>{t('ov.features', 'Privilegi e talenti')}</h3>
          {features.length === 0 && <div className="muted">{t('ov.none', 'Nessuno.')}</div>}
          {features.map((f, i) => (
            <details key={i}>
              <summary>{f.name} <span className="muted">— {f.source}</span></summary>
              <div className="muted" style={{ padding: '4px 0 6px' }}>{f.description}</div>
            </details>
          ))}
          {char.feats.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {char.feats.map((f) => {
                const feat = reg.feats.get(f);
                return <span key={f} className="tag custom">{feat?.name ?? f}</span>;
              })}
            </div>
          )}
        </div>
        <div className="card">
          <h3>{t('ov.carrying', 'Portata e altro')}</h3>
          <div className="muted">{tf('ov.carryCap', 'Capacità di carico: {n} libbre (impedito {a}, pesante {b}, trascina {c})', { n: cap.normal, a: cap.encumbered, b: cap.heavyLoad, c: cap.pushDrag })}</div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={exportChar}>{t('ov.exportJson', 'Esporta JSON')}</button>
            <label style={{ margin: 0, width: 'auto' }} className="row">
              <input type="file" accept="application/json" onChange={importChar} style={{ width: 'auto' }} /> {t('ov.import', 'Importa')}
            </label>
            <button className="danger" onClick={() => { if (confirm(t('ov.deleteConfirm', 'Eliminare questa scheda?'))) resetChar(); }}>{t('ov.deleteSheet', 'Elimina scheda')}</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={exportLibrary} title={t('ov.exportLibTitle', 'Tutte le schede + i contenuti custom in un file')}>{tf('ov.exportLib', '📦 Esporta libreria ({n} schede)', { n: sheets.length })}</button>
            <label style={{ margin: 0, width: 'auto' }} className="row">
              <input type="file" accept="application/json" onChange={importLibrary} style={{ width: 'auto' }} /> {t('ov.importLib', 'Importa libreria')}
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => printSheet(char, reg)} title={t('ov.exportPdfTitle', 'Apre una versione stampabile della scheda: dal browser usa Ctrl+P → Salva come PDF')}>{t('ov.exportPdf', '🖨 Esporta PDF')}</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {!lock.enabled ? (
              <button onClick={setupLock} title={t('ov.lockSetTitle', "Richiedi una password locale all'apertura dell'app (protegge le schede offline)")}>{t('ov.lockSet', '🔐 Imposta blocco app')}</button>
            ) : (
              <>
                <span className="tag custom">{t('ov.lockOn', '🔐 blocco app attivo')}</span>
                <button onClick={changeLock}>{t('ov.lockChange', 'Cambia password')}</button>
                <button className="danger" onClick={disableLock}>{t('ov.lockOff', 'Disabilita blocco')}</button>
              </>
            )}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>{t('ov.lockHint', "Il blocco app è una password SOLO locale (hash salvato in questo browser): protegge le schede offline su questo dispositivo, non ha niente a che fare con l'account server.")}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>{t('ov.journal', '📖 Diario di sessione')}</h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <input
            value={journalText}
            onChange={(e) => setJournalText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addJournalEntry(); }}
            placeholder={t('ov.journalPh', 'Aggiungi una nota (ricompensa, indizio, evento...)')}
            style={{ flex: 1 }}
          />
          <button onClick={addJournalEntry} disabled={!journalText.trim()}>{t('ov.journalAdd', 'Aggiungi')}</button>
        </div>
        <div style={{ maxHeight: 260, overflow: 'auto', fontSize: 13 }}>
          {(char.journal ?? []).length === 0 && (
            <div className="muted">{t('ov.journalEmpty', 'Ancora nessuna voce: XP, danni, cure, tiri della morte, level-up e incantesimi lanciati vengono registrati automaticamente.')}</div>
          )}
          {(char.journal ?? []).slice().reverse().map((j, i) => (
            <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="muted">{new Date(j.at).toLocaleString('it-IT')}</span> — {j.text}
            </div>
          ))}
        </div>
      </div>

      {showLevelUp && <LevelUpDialog onClose={() => setShowLevelUp(false)} />}
    </div>
  );
}

export { XP_TABLE };
