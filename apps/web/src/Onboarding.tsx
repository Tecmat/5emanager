import { useMemo, useState } from 'react';
import { createCharacter, generateAbilityScores, type AbilityScores } from '@dnd5e/core';
import { useStore } from './store.js';
import Icon from './icons.js';

export const ONBOARD_KEY = 'dnd5e.onboarded.v1';

const DEFAULT_SCORES: AbilityScores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

/**
 * Onboarding primo avvio: wizard in 3 passi (nome/razza/classe -> punteggi -> crea).
 * Mostrato solo se non ci sono schede e l'utente non l'ha mai saltato/completato.
 */
export default function Onboarding({ onDone, onOpenCreate }: { onDone: () => void; onOpenCreate: () => void }) {
  const { reg, createSheet, t, tf } = useStore();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [name, setName] = useState('');
  const [raceId, setRaceId] = useState('human');
  const [classId, setClassId] = useState('fighter');
  const [scores, setScores] = useState<AbilityScores>(DEFAULT_SCORES);
  const [err, setErr] = useState('');

  const races = useMemo(() => [...reg.races.values()], [reg]);
  const classes = useMemo(() => [...reg.classes.values()], [reg]);
  const cls = reg.classes.get(classId);
  const choose = cls?.skillChoices.choose ?? 0;

  const finish = () => {
    setErr('');
    // competenze di default: le prime `choose` della classe; stile di combattimento: il primo disponibile
    const skillChoices = (cls?.skillChoices.from ?? []).slice(0, choose);
    const styleOptions = (cls?.features[1] ?? []).flatMap((f) => f.effects).flatMap((e) => (e.type === 'fightingStyle' ? e.options : []));
    const res = createCharacter(
      {
        name: name.trim() || t('ob.defaultName', 'Eroe senza nome'),
        raceId,
        classId,
        abilityScores: scores,
        skillChoices,
        fightingStyleId: styleOptions.length ? styleOptions[0] : undefined,
      },
      reg,
    );
    if (!res.character || res.errors.length) {
      setErr(res.errors.join('\n') || t('cf.unknownError', 'Errore sconosciuto'));
      return;
    }
    createSheet(res.character);
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* quota */ }
    onDone();
  };

  const skip = () => {
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* quota */ }
    onDone();
  };

  const abRow = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((ab) => (
    <div key={ab} className="ob-ab">
      <b>{ab.toUpperCase()}</b>
      <span>{scores[ab]}</span>
    </div>
  ));

  return (
    <div className="modal-bg" role="dialog" aria-label={t('ob.title', 'Crea il tuo primo personaggio')}>
      <div className="card" style={{ maxWidth: 520, width: '92vw', maxHeight: '88vh', overflow: 'auto' }}>
        <h3><Icon name="swords" size={15} /> {t('ob.title', 'Crea il tuo primo personaggio')}</h3>
        <div className="muted" style={{ marginBottom: 10 }}>{tf('ob.step', 'Passo {n} di 3', { n: step + 1 })}</div>

        {step === 0 && (
          <>
            <label>{t('cf.name', 'Nome')}</label>
            <input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t('cf.namePh', 'Aldric il Coraggioso')} />
            <div className="grid cols2">
              <div>
                <label>{t('cf.race', 'Razza')}</label>
                <select value={raceId} onChange={(e) => setRaceId(e.target.value)}>
                  {races.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label>{t('cf.class', 'Classe')}</label>
                <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <label>{t('ob.scores', 'Punteggi caratteristica')}</label>
            <div className="row" style={{ marginBottom: 8 }}>
              <button onClick={() => setScores(DEFAULT_SCORES)}>{t('ob.standard', 'Array standard (15/14/13/12/10/8)')}</button>
              <button onClick={() => setScores(generateAbilityScores('roll'))}><Icon name="dice" size={13} /> {t('ob.roll', 'Tira i dadi (4d6, scarta il più basso)')}</button>
            </div>
            <div className="ob-scores">{abRow}</div>
            <div className="muted" style={{ marginTop: 6 }}>{t('ob.scoresHint', 'Puoi cambiarli dopo dal form completo (point-buy / tiri).')}</div>
          </>
        )}

        {step === 2 && (
          <div className="muted">
            {tf('ob.summary', 'Pronto: {name}, {race}, {class} di livello 1 con punteggi {s}.', {
              name: name.trim() || t('ob.defaultName', 'Eroe senza nome'),
              race: reg.races.get(raceId)?.name ?? raceId,
              class: cls?.name ?? classId,
              s: (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((ab) => `${ab.toUpperCase()} ${scores[ab]}`).join(' · '),
            })}
          </div>
        )}

        {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}

        <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
          <span className="row">
            <button onClick={skip}>{t('ob.skip', 'Salta')}</button>
            <button onClick={onOpenCreate}>{t('ob.full', 'Form completo')}</button>
          </span>
          <span className="row">
            {step > 0 && <button onClick={() => setStep((s) => (s - 1) as 0 | 1 | 2)}>{t('ob.back', 'Indietro')}</button>}
            {step < 2 ? (
              <button className="primary" onClick={() => setStep((s) => (s + 1) as 0 | 1 | 2)}>{t('ob.next', 'Avanti')}</button>
            ) : (
              <button className="primary" onClick={finish}><Icon name="check" size={14} /> {t('ob.create', 'Crea il personaggio')}</button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
