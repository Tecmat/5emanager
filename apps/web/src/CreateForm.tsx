import { useMemo, useState } from 'react';
import { ABILITIES, createCharacter, SKILLS, type Ability, type AbilityScores } from '@dnd5e/core';
import { useStore } from './store.js';

const DEFAULT_SCORES: AbilityScores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

export default function CreateForm() {
  const { reg, setChar } = useStore();
  const [name, setName] = useState('');
  const [raceId, setRaceId] = useState('human');
  const [subraceId, setSubraceId] = useState<string>('');
  const [classId, setClassId] = useState('fighter');
  const [scores, setScores] = useState<AbilityScores>(DEFAULT_SCORES);
  const [skills, setSkills] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const race = reg.races.get(raceId);
  const cls = reg.classes.get(classId);
  const choose = cls?.skillChoices.choose ?? 0;

  const toggleSkill = (id: string) => {
    setSkills((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= choose) return s;
      return [...s, id];
    });
  };

  const submit = () => {
    const res = createCharacter(
      { name: name.trim() || 'Senza nome', raceId, subraceId: subraceId || undefined, classId, abilityScores: scores, skillChoices: skills },
      reg,
    );
    if (res.errors.length > 0 || !res.character) {
      setErrors(res.errors.length ? res.errors : ['Errore sconosciuto']);
      return;
    }
    setChar(res.character);
  };

  const races = useMemo(() => [...reg.races.values()], [reg]);
  const classes = useMemo(() => [...reg.classes.values()], [reg]);

  return (
    <main>
      <div className="card" style={{ maxWidth: 640, margin: '30px auto' }}>
        <h3>Nuovo personaggio</h3>
        <label>Nome</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aldric il Coraggioso" />
        <div className="grid cols2">
          <div>
            <label>Razza</label>
            <select value={raceId} onChange={(e) => { setRaceId(e.target.value); setSubraceId(''); }}>
              {races.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Sottorazza</label>
            <select value={subraceId} onChange={(e) => setSubraceId(e.target.value)}>
              <option value="">(nessuna)</option>
              {(race?.subraces ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Classe</label>
            <select value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name} (d{c.hitDie})</option>
              ))}
            </select>
          </div>
        </div>
        <label>Punteggi caratteristica</label>
        <div className="grid cols3">
          {ABILITIES.map((ab: Ability) => (
            <div key={ab}>
              <label>{ab.toUpperCase()}</label>
              <input
                type="number" min={1} max={20}
                value={scores[ab]}
                onChange={(e) => setScores({ ...scores, [ab]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
        <label>Abilità della classe ({choose} a scelta)</label>
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
        <div style={{ marginTop: 14 }}>
          <button className="primary" onClick={submit}>Crea personaggio</button>
        </div>
      </div>
    </main>
  );
}
