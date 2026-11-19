import { useMemo, useState } from 'react';
import {
  ABILITIES,
  applyLevelUp,
  totalLevel,
  type Ability,
  type LevelUpChoices,
} from '@dnd5e/core';
import { useStore } from './store.js';

const ABILITY_IT: Record<Ability, string> = { str: 'Forza', dex: 'Destrezza', con: 'Costituzione', int: 'Intelligenza', wis: 'Saggezza', cha: 'Carisma' };

export default function LevelUpDialog({ onClose }: { onClose: () => void }) {
  const { reg, char, setChar, t, tf } = useStore();
  const [classId, setClassId] = useState(char?.classLevels[0]?.classId ?? '');
  const [hpRoll, setHpRoll] = useState<number | ''>('');
  const [fightingStyleId, setFightingStyleId] = useState('');
  const [subclassId, setSubclassId] = useState('');
  const [mode, setMode] = useState<'asi' | 'feat'>('asi');
  const [asiA, setAsiA] = useState<Ability>('str');
  const [asiB, setAsiB] = useState<Ability>('str');
  const [asiSplit, setAsiSplit] = useState(false);
  const [featId, setFeatId] = useState('');
  const [expertise, setExpertise] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  if (!char) return null;

  const cls = reg.classes.get(classId);
  const current = char.classLevels.find((c) => c.classId === classId)?.level ?? 0;
  const newLevel = current + 1;
  const feats = cls?.features[newLevel] ?? [];

  const needsFightingStyle = feats.some((f) => f.effects.some((e) => e.type === 'fightingStyle'));
  const styleOptions = feats.flatMap((f) => f.effects.flatMap((e) => (e.type === "fightingStyle" ? e.options : [])));
  const needsSubclass = feats.some((f) => f.effects.some((e) => e.type === 'subclass'));
  // tutti gli archetipi disponibili per la classe (dal registro), non solo quelli listed nell'effetto
  const subclassOptions = (() => {
    const fromReg = [...reg.subclasses.values()].filter((s) => s.classId === classId).map((s) => s.id);
    if (fromReg.length) return fromReg;
    return feats.flatMap((f) => f.effects.flatMap((e) => (e.type === "subclass" ? e.options : [])));
  })();
  const hasAsi = feats.some((f) => f.effects.some((e) => e.type === 'asi'));
  const expertiseChoose = feats.reduce((n, f) => n + f.effects.filter((e) => e.type === 'expertise').reduce((a, e) => a + (e.type === 'expertise' ? e.choose : 0), 0), 0);
  const expertiseFrom = feats.flatMap((f) => f.effects.flatMap((e) => (e.type === "expertise" ? e.from : [])));
  const avg = cls ? Math.floor(cls.hitDie / 2) + 1 : 0;

  const grantedNames = useMemo(() => feats.map((f) => f.name), [feats]);

  const submit = () => {
    const choices: LevelUpChoices = { classId, hpRoll: hpRoll === '' ? undefined : Number(hpRoll) };
    if (needsFightingStyle) choices.fightingStyleId = fightingStyleId;
    if (needsSubclass) choices.subclassId = subclassId;
    if (hasAsi) {
      if (mode === 'feat') choices.featId = featId;
      else choices.asi = asiSplit ? { [asiA]: 1, [asiB]: 1 } : { [asiA]: 2 };
    }
    if (expertiseChoose > 0) choices.expertiseSkills = expertise;
    const res = applyLevelUp(char, reg, choices);
    if (res.errors.length > 0) {
      setErrors(res.errors);
      return;
    }
    setChar(res.character);
    onClose();
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('lu.title', 'Sali di livello')} — {cls?.name} {newLevel}</h2>
        <label>{t('lu.class', 'Classe')}</label>
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          {[...new Set([...char.classLevels.map((c) => c.classId), ...[...reg.classes.keys()]])].map((id) => (
            <option key={id} value={id}>{reg.classes.get(id)?.name ?? id}</option>
          ))}
        </select>

        <label>{tf('lu.hitDie', 'Tiro dado vita (d{d}) — vuoto = media ({avg})', { d: cls?.hitDie ?? 0, avg })}</label>
        <input type="number" min={1} max={cls?.hitDie} value={hpRoll} onChange={(e) => setHpRoll(e.target.value === '' ? '' : Number(e.target.value))} />

        {needsFightingStyle && (
          <>
            <label>{t('lu.style', 'Stile di combattimento')}</label>
            <select value={fightingStyleId} onChange={(e) => setFightingStyleId(e.target.value)}>
              <option value="">— scegli —</option>
              {styleOptions.map((o) => <option key={o} value={o}>{reg.fightingStyles.get(o)?.name ?? o}</option>)}
            </select>
          </>
        )}

        {needsSubclass && (
          <>
            <label>{t('lu.subclass', 'Archetipo / Sottoclasse')}</label>
            <select value={subclassId} onChange={(e) => setSubclassId(e.target.value)}>
              <option value="">— scegli —</option>
              {subclassOptions.map((o) => <option key={o} value={o}>{reg.subclasses.get(o)?.name ?? o}</option>)}
            </select>
          </>
        )}

        {hasAsi && (
          <>
            <label>{t('lu.asi', 'Aumento caratteristiche o talento')}</label>
            <div className="row">
              <label style={{ margin: 0 }}><input type="radio" checked={mode === 'asi'} onChange={() => setMode('asi')} style={{ width: 'auto' }} /> ASI (+2)</label>
              <label style={{ margin: 0 }}><input type="radio" checked={mode === 'feat'} onChange={() => setMode('feat')} style={{ width: 'auto' }} /> Talento</label>
            </div>
            {mode === 'asi' && (
              <div className="row" style={{ marginTop: 4 }}>
                <select value={asiA} onChange={(e) => setAsiA(e.target.value as Ability)}>
                  {ABILITIES.map((a) => <option key={a} value={a}>{ABILITY_IT[a]}</option>)}
                </select>
                {!asiSplit && <span className="muted">+2</span>}
                <label style={{ margin: 0 }}><input type="checkbox" checked={asiSplit} onChange={(e) => setAsiSplit(e.target.checked)} style={{ width: 'auto' }} /> dividi +1/+1</label>
                {asiSplit && (
                  <select value={asiB} onChange={(e) => setAsiB(e.target.value as Ability)}>
                    {ABILITIES.map((a) => <option key={a} value={a}>{ABILITY_IT[a]}</option>)}
                  </select>
                )}
              </div>
            )}
            {mode === 'feat' && (
              <select value={featId} onChange={(e) => setFeatId(e.target.value)}>
                <option value="">— scegli talento —</option>
                {[...reg.feats.values()].map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
          </>
        )}

        {expertiseChoose > 0 && (
          <>
            <label>{tf('lu.expertise', 'Competenza expertise ({n} a scelta)', { n: expertiseChoose })}</label>
            <div>
              {expertiseFrom.map((sid) => (
                <span
                  key={sid}
                  className={`tag ${expertise.includes(sid) ? 'custom' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpertise((s) => s.includes(sid) ? s.filter((x) => x !== sid) : s.length < expertiseChoose ? [...s, sid] : s)}
                >
                  {sid}
                </span>
              ))}
            </div>
          </>
        )}

        {grantedNames.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="muted">Otterrai: {grantedNames.join(', ')}</div>
          </div>
        )}
        {errors.length > 0 && <div className="error">{errors.join('\n')}</div>}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" onClick={submit}>{t('lu.confirm', 'Conferma level-up')}</button>
          <button onClick={onClose}>{t('lu.cancel', 'Annulla')}</button>
        </div>
      </div>
    </div>
  );
}
