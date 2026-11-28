import { useMemo, useState } from 'react';
import {
  ABILITIES, createCharacter, generateAbilityScores, isPointBuyValid,
  POINT_BUY_BUDGET, POINT_BUY_MAX, POINT_BUY_MIN, pointBuySpent, pointCostTo,
  rollDice, SKILLS, STANDARD_ARRAY, type Ability, type AbilityScores, type StatGenMode,
} from '@dnd5e/core';
import { useStore } from './store.js';

const DEFAULT_SCORES: AbilityScores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

export default function CreateForm({ onCancel }: { onCancel?: () => void }) {
  const { reg, createSheet, t } = useStore();
  const [name, setName] = useState('');
  const [raceId, setRaceId] = useState('human');
  const [subraceId, setSubraceId] = useState<string>('');
  const [classId, setClassId] = useState('fighter');
  const [backgroundId, setBackgroundId] = useState('');
  const [scores, setScores] = useState<AbilityScores>(DEFAULT_SCORES);
  const [mode, setMode] = useState<StatGenMode>('standard');
  const [skills, setSkills] = useState<string[]>([]);
  const [fightingStyleId, setFightingStyleId] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const switchMode = (m: StatGenMode) => {
    setMode(m);
    setScores(generateAbilityScores(m));
  };

  const bumpScore = (ab: Ability, delta: number) => {
    setScores((s) => {
      const next = Math.min(POINT_BUY_MAX, Math.max(POINT_BUY_MIN, s[ab] + delta));
      if (next === s[ab]) return s;
      if (pointBuySpent(s) - pointCostTo(s[ab]) + pointCostTo(next) > POINT_BUY_BUDGET) return s;
      return { ...s, [ab]: next };
    });
  };

  const canBumpUp = (ab: Ability) => {
    const next = scores[ab] + 1;
    if (next > POINT_BUY_MAX) return false;
    return pointBuySpent(scores) - pointCostTo(scores[ab]) + pointCostTo(next) <= POINT_BUY_BUDGET;
  };

  const rollOne = (ab: Ability) => {
    const r = rollDice('4d6');
    if (!r) return;
    setScores((s) => ({ ...s, [ab]: r.total - Math.min(...r.rolls) }));
  };

  const race = reg.races.get(raceId);
  const cls = reg.classes.get(classId);
  const choose = cls?.skillChoices.choose ?? 0;
  // stile di combattimento al 1° livello, se la classe lo prevede (es. guerriero)
  const styleOptions = (cls?.features[1] ?? []).flatMap((f) => f.effects).flatMap((e) => (e.type === 'fightingStyle' ? e.options : []));
  const styleChoice = styleOptions.length ? (fightingStyleId || styleOptions[0]) : '';

  const toggleSkill = (id: string) => {
    setSkills((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= choose) return s;
      return [...s, id];
    });
  };

  const submit = () => {
    if (mode === 'pointbuy' && !isPointBuyValid(scores)) {
      setErrors([`${t('cf.pbError', 'Point-buy non valido: punteggi 8-15, budget')} ${POINT_BUY_BUDGET} (${t('cf.used', 'usati')} ${pointBuySpent(scores)})`]);
      return;
    }
    const res = createCharacter(
      { name: name.trim() || 'Senza nome', raceId, subraceId: subraceId || undefined, classId, background: backgroundId || undefined, abilityScores: scores, skillChoices: skills, fightingStyleId: styleOptions.length ? styleChoice : undefined },
      reg,
    );
    if (res.errors.length > 0 || !res.character) {
      setErrors(res.errors.length ? res.errors : [t('cf.unknownError', 'Errore sconosciuto')]);
      return;
    }
    createSheet(res.character);
  };

  const races = useMemo(() => [...reg.races.values()], [reg]);
  const classes = useMemo(() => [...reg.classes.values()], [reg]);

  return (
    <main>
      <form
        className="card"
        style={{ maxWidth: 640, margin: '30px auto' }}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <h3>{t('cf.title', 'Nuovo personaggio')}</h3>
        <label>{t('cf.name', 'Nome')}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cf.namePh', 'Aldric il Coraggioso')} />
        <div className="grid cols2">
          <div>
            <label>{t('cf.race', 'Razza')}</label>
            <select value={raceId} onChange={(e) => { setRaceId(e.target.value); setSubraceId(''); }}>
              {races.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>{t('cf.subrace', 'Sottorazza')}</label>
            <select value={subraceId} onChange={(e) => setSubraceId(e.target.value)}>
              <option value="">{t('cf.none', '(nessuna)')}</option>
              {(race?.subraces ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>{t('cf.class', 'Classe')}</label>
            <select value={classId} onChange={(e) => { setClassId(e.target.value); setFightingStyleId(''); }}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name} (d{c.hitDie})</option>
              ))}
            </select>
          </div>
          <div>
            <label>{t('cf.background', 'Background')}</label>
            <select value={backgroundId} onChange={(e) => setBackgroundId(e.target.value)}>
              <option value="">{t('cf.none', '(nessuno)')}</option>
              {[...reg.backgrounds.values()].map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          {styleOptions.length > 0 && (
            <div>
              <label>{t('cf.fightingStyle', 'Stile di combattimento')} (liv 1)</label>
              <select value={styleChoice} onChange={(e) => setFightingStyleId(e.target.value)}>
                {styleOptions.map((o) => (
                  <option key={o} value={o}>{reg.fightingStyles.get(o)?.name ?? o}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <label>{t('cf.method', 'Metodo statistiche')}</label>
        <div className="segmented">
          {([['standard', t('cf.standard', 'Array standard')], ['pointbuy', t('cf.pointbuy', 'Point-buy (27 pt)')], ['roll', t('cf.roll', 'Tiri 4d6')]] as [StatGenMode, string][]).map(([m, label]) => (
            <button key={m} type="button" className={mode === m ? 'seg active' : 'seg'} onClick={() => switchMode(m)}>{label}</button>
          ))}
        </div>
        <label>
          {t('cf.scores', 'Punteggi caratteristica')}
          {mode === 'pointbuy' && ` — ${t('cf.used', 'punti usati')}: ${pointBuySpent(scores)} / ${POINT_BUY_BUDGET}`}
        </label>
        <div className="grid cols3">
          {ABILITIES.map((ab: Ability) => (
            <div key={ab}>
              <label>{ab.toUpperCase()}</label>
              {mode === 'standard' && (
                <select value={scores[ab]} onChange={(e) => setScores({ ...scores, [ab]: Number(e.target.value) })}>
                  {STANDARD_ARRAY.map((v) => {
                    const usedElsewhere = ABILITIES.some((a) => a !== ab && scores[a] === v);
                    return <option key={v} value={v} disabled={usedElsewhere && scores[ab] !== v}>{v}</option>;
                  })}
                </select>
              )}
              {mode === 'pointbuy' && (
                <div className="pb-row">
                  <button type="button" disabled={scores[ab] <= POINT_BUY_MIN} onClick={() => bumpScore(ab, -1)}>−</button>
                  <span className="pb-val">{scores[ab]} <small>({pointCostTo(scores[ab])} pt)</small></span>
                  <button type="button" disabled={!canBumpUp(ab)} onClick={() => bumpScore(ab, +1)}>+</button>
                </div>
              )}
              {mode === 'roll' && (
                <div className="pb-row">
                  <input type="number" readOnly value={scores[ab]} />
                  <button type="button" onClick={() => rollOne(ab)}>{t('cf.rollOne', 'Tira 4d6')}</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {mode === 'roll' && (
          <div style={{ marginTop: 6 }}>
            <button type="button" onClick={() => setScores(generateAbilityScores('roll'))}>{t('cf.rollAll', 'Tira tutti (4d6, scarta il peggiore)')}</button>
          </div>
        )}
        <label>{t('cf.skills', 'Abilità della classe')} ({choose} {t('cf.choose', 'a scelta')})</label>
        <div>
          {(cls?.skillChoices.from ?? []).map((sid) => {
            const sk = SKILLS.find((s) => s.id === sid);
            return (
              <span key={sid} className={`tag ${skills.includes(sid) ? 'custom' : ''}`} style={{ cursor: 'pointer' }} onClick={() => toggleSkill(sid)}>
                {sk?.name ?? sid}
              </span>
            );
          })}
        </div>
        {errors.length > 0 && <div className="error">{errors.join('\n')}</div>}
        <div style={{ marginTop: 14 }} className="row">
          <button type="submit" className="primary">{t('cf.create', 'Crea personaggio')}</button>
          {onCancel && <button type="button" onClick={onCancel}>{t('cf.cancel', 'Annulla')}</button>}
        </div>
      </form>
    </main>
  );
}
