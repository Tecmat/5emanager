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
  longRest,
  maxHp,
  migrateCharacter,
  passivePerception,
  proficiencyBonus,
  recordDeathSave,
  savingThrowBonus,
  setExhaustion,
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
import { CUSTOM_KEY, persistCustom, useStore } from './store.js';
import LevelUpDialog from './LevelUpDialog.js';
import DiceRoller from './DiceRoller.js';

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

export default function Overview() {
  const { reg, char, setChar, createSheet, importSheets, sheets, resetChar } = useStore();
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [dmg, setDmg] = useState(0);
  const [healAmt, setHealAmt] = useState(0);
  const [xpAmt, setXpAmt] = useState(300);
  const portraitRef = useRef<HTMLInputElement>(null);

  const uploadPortrait = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Scegli un file immagine (png, jpg, webp...)');
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
    img.onerror = () => alert('Immagine non valida');
    img.src = URL.createObjectURL(file);
  };

  if (!char) return null;
  const level = totalLevel(char);
  const pb = proficiencyBonus(level);
  const hpMax = maxHp(char, reg);
  const { ac, breakdown } = armorClass(char, reg);
  const cap = carryingCapacity(char);
  const race = reg.races.get(char.raceId);
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

  const exportChar = () => {
    const blob = new Blob([JSON.stringify(char, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${char.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
  };

  const importChar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      try {
        createSheet(migrateCharacter(JSON.parse(t) as Character));
      } catch {
        alert('File JSON non valido');
      }
    });
  };

  const exportLibrary = () => {
    let custom: unknown = {};
    try { custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '{}'); } catch { /* vuoto */ }
    const data = {
      app: '5emanager', version: 1, exportedAt: new Date().toISOString(),
      sheets, custom,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '5emanager-libreria.json';
    a.click();
  };

  const importLibrary = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      try {
        const d = JSON.parse(t) as { sheets?: Character[]; custom?: Record<string, unknown[]> };
        if (!d || !Array.isArray(d.sheets)) throw new Error('formato non riconosciuto');
        importSheets(d.sheets);
        if (d.custom) {
          // merge dei contenuti custom per id
          const cur = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '{}') as Record<string, any[]>;
          for (const [k, arr] of Object.entries(d.custom as Record<string, any[]>)) {
            if (!Array.isArray(arr)) continue;
            const map = new Map<string, any>((cur[k] ?? []).map((x: any) => [x.id as string, x]));
            for (const x of arr) if (x && typeof x.id === 'string') map.set(x.id, x);
            cur[k] = [...map.values()];
          }
          persistCustom(cur as never);
        }
        alert(`Libreria importata: ${d.sheets.length} schede${d.custom ? ' + contenuti custom' : ''}.`);
      } catch (err) {
        alert('File non valido: ' + (err as Error).message);
      }
    });
  };

  return (
    <div className="grid">
      <div className="grid cols3">
        <div className="card">
          <h3>Personaggio</h3>
          <div className="row" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
            {char.portrait
              ? <img className="portrait" src={char.portrait} alt={`Ritratto di ${char.name}`} />
              : <div className="portrait-ph">nessun<br />ritratto</div>}
            <div>
              <div className="row">
                <button onClick={() => portraitRef.current?.click()}>📷 {char.portrait ? 'Cambia ritratto' : 'Carica ritratto'}</button>
                {char.portrait && (
                  <button className="danger" onClick={() => setChar({ ...char, portrait: undefined, updatedAt: new Date().toISOString() })}>Rimuovi</button>
                )}
              </div>
              <input ref={portraitRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadPortrait} />
              <div className="muted" style={{ fontSize: 11, marginTop: 4, maxWidth: 220 }}>
                Ridimensionata a 256px e salvata solo nel browser (localStorage).
              </div>
            </div>
          </div>
          <div className="big">{char.name}</div>
          <div className="muted">{race?.name}{subrace ? ` (${subrace.name})` : ''} — {classNames.join(' / ')}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="tag">Livello {level}</span>
            <span className="tag">PF {char.hp.current}/{hpMax}{char.hp.temp > 0 ? ` (+${char.hp.temp} temp)` : ''}</span>
            <span className="tag">CA {ac}</span>
            <span className="tag">Iniziativa {fmt(initiativeBonus(char))}</span>
            <span className="tag">Percezione passiva {passivePerception(char)}</span>
            <span className="tag">Bonus proficiency {fmt(pb)}</span>
            <button
              className={`tag ${char.inspiration ? 'custom' : ''}`}
              style={{ cursor: 'pointer', background: 'var(--panel2)', color: 'inherit', border: '1px solid var(--border)' }}
              onClick={() => setChar({ ...char, inspiration: !char.inspiration, updatedAt: new Date().toISOString() })}
              title="Attiva/disattiva ispirazione"
            >
              ⭐ {char.inspiration ? 'Ispirazione attiva' : 'Ispirazione'}
            </button>
          </div>
          <div className="muted" style={{ marginTop: 6 }} title={breakdown.join('\n')}>CA: {breakdown.join(' · ')}</div>
          {spellcastingInfoAll(char, reg).length > 0 && (
            <div className="row" style={{ marginTop: 6 }}>
              {spellcastingInfoAll(char, reg).map((si) => (
                <span key={si.classId} className="tag" title={`Incantesimi di ${reg.classes.get(si.classId)?.name} (caratteristica ${si.ability.toUpperCase()})`}>
                  🔮 {reg.classes.get(si.classId)?.name}: attacco {fmt(si.attackBonus)} · CD {si.saveDC}
                </span>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <label style={{ margin: 0 }}>Esaurimento</label>
            <select value={char.exhaustion ?? 0} onChange={(e) => setChar(setExhaustion(char, Number(e.target.value)))} style={{ width: 'auto' }}>
              {Array.from({ length: EXHAUSTION_MAX + 1 }).map((_, l) => <option key={l} value={l}>{l === 0 ? '—' : `liv ${l}`}</option>)}
            </select>
            <span className="muted">{EXH_LABELS[Math.min(EXHAUSTION_MAX, char.exhaustion ?? 0)]}</span>
            <span className="tag">Velocità {speedOf(char, reg)}</span>
          </div>
          {char.hp.current <= 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <b>Tiri della morte</b>
              {[0, 1, 2].map((i) => (
                <button key={'s' + i} className={i < (char.deathSaves?.successes ?? 0) ? 'primary' : ''} onClick={() => setChar(recordDeathSave(char, true))} title="Successo">✓</button>
              ))}
              {[0, 1, 2].map((i) => (
                <button key={'f' + i} className="danger" style={{ opacity: i < (char.deathSaves?.failures ?? 0) ? 1 : 0.45 }} onClick={() => setChar(recordDeathSave(char, false))} title="Fallimento">✗</button>
              ))}
              {isDead(char) ? <span className="error">💀 morto</span> : <span className="muted">3 ✓ = risveglio a 1 PF · 3 ✗ = morto</span>}
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <input type="number" style={{ width: 70 }} value={dmg} onChange={(e) => setDmg(Number(e.target.value))} />
            <button onClick={() => setChar(damage(char, dmg))}>Danni</button>
            <input type="number" style={{ width: 70 }} value={healAmt} onChange={(e) => setHealAmt(Number(e.target.value))} />
            <button onClick={() => setChar(heal(char, healAmt, hpMax))}>Cura</button>
            <button onClick={() => setChar(longRest(char, reg))}>Riposo lungo</button>
          </div>
        </div>

        <div className="card">
          <h3>Esperienza</h3>
          <div className="row">
            <span className="big">{char.xp} XP</span>
            <span className="muted">livello {level}{xpNext ? ` / ${xpNext} XP` : ' (max)'}</span>
          </div>
          <div className="xpbar"><div style={{ width: `${xpProgress}%` }} /></div>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="number" style={{ width: 90 }} value={xpAmt} onChange={(e) => setXpAmt(Number(e.target.value))} />
            <button onClick={() => setChar(addXp(char, xpAmt))}>Aggiungi XP</button>
            <button className="primary" disabled={!canLevelUp(char)} onClick={() => setShowLevelUp(true)}>
              Sali di livello
            </button>
          </div>
          {!canLevelUp(char) && level < 20 && <div className="muted">Servono {xpForLevel(level + 1) - char.xp} XP in più.</div>}
          <div className="muted">Livello da XP: {levelForXp(char.xp)}</div>
        </div>

        <div className="card">
          <h3>Caratteristiche</h3>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {ABILITIES.map((ab) => (
              <div key={ab} className="abil">
                <div className="muted" style={{ fontSize: 10 }}>{ABILITY_IT[ab]}</div>
                <div className="score">{char.abilityScores[ab]}</div>
                <div className="mod">{fmt(Math.floor((char.abilityScores[ab] - 10) / 2))}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid cols2">
        <div className="card">
          <h3>Tiri Salvezza</h3>
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
          <h3>Abilità</h3>
          <table>
            <tbody>
              {SKILLS.map((s) => {
                const b = skillBonus(char, s.id);
                const prof = char.proficiency.skills.includes(s.id);
                const exp = char.proficiency.expertise.includes(s.id);
                return (
                  <tr key={s.id}>
                    <td>{s.name} <span className="muted">({s.ability})</span></td>
                    <td><b>{fmt(b)}</b> {exp && <span className="tag custom">espertise</span>}{prof && !exp && <span className="tag">prof</span>}</td>
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
          <h3>🩸 Condizioni attive</h3>
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
          <div className="muted" style={{ marginTop: 6 }}>Clicca per aggiungere/rimuovere. Le condizioni con svantaggio (avvelenato, spaventato, prono...) sono annotate nel tira-dado.</div>
        </div>
      </div>

      <div className="grid cols2">
        <div className="card">
          <h3>⚙️ Selettore regole (house-rules: eludi le regole)</h3>
          {RULE_LABELS.map(([key, label]) => (
            <div key={key}>
              <label style={{ margin: '6px 0 0', color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={char.houseRules?.[key] ?? false}
                  onChange={() => setChar({ ...char, houseRules: { ...DEFAULT_HOUSE_RULES, ...char.houseRules, [key]: !(char.houseRules?.[key] ?? false) }, updatedAt: new Date().toISOString() })}
                  style={{ width: 'auto', marginRight: 6 }}
                />
                {label}
              </label>
            </div>
          ))}
          <div className="muted" style={{ marginTop: 8 }}>Utile per testare o per campagne con regole della casa.</div>
        </div>
        <div className="card">
          <h3>🔓 Meccaniche sbloccate (scalano col livello)</h3>
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
          <h3>Privilegi e talenti</h3>
          {features.length === 0 && <div className="muted">Nessuno.</div>}
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
          <h3>Portata e altro</h3>
          <div className="muted">Capacità di carico: {cap.normal} libbre (impedito {cap.encumbered}, pesante {cap.heavyLoad}, trascina {cap.pushDrag})</div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={exportChar}>Esporta JSON</button>
            <label style={{ margin: 0, width: 'auto' }} className="row">
              <input type="file" accept="application/json" onChange={importChar} style={{ width: 'auto' }} /> Importa
            </label>
            <button className="danger" onClick={() => { if (confirm('Eliminare questa scheda?')) resetChar(); }}>Elimina scheda</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={exportLibrary} title="Tutte le schede + i contenuti custom in un file">📦 Esporta libreria ({sheets.length} schede)</button>
            <label style={{ margin: 0, width: 'auto' }} className="row">
              <input type="file" accept="application/json" onChange={importLibrary} style={{ width: 'auto' }} /> Importa libreria
            </label>
          </div>
        </div>
      </div>

      {showLevelUp && <LevelUpDialog onClose={() => setShowLevelUp(false)} />}
    </div>
  );
}

export { XP_TABLE };
