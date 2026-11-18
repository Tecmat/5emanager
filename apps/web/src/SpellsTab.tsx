import { useMemo, useState } from 'react';
import {
  addSpellKnown,
  castersOf,
  castSpell,
  castSpellRitual,
  forgetSpell,
  isMaterialConsumed,
  knownSpellCount,
  learnableSpells,
  materialText,
  maxSpellsKnown,
  prepareSpellForClass,
  preparedSpellsOfClass,
  unprepareSpellForClass,
  type SpellDef,
} from '@dnd5e/core';
import { useStore } from './store.js';

function SpellRow({ spell, char, reg, onChange }: { spell: SpellDef; char: ReturnType<typeof useStore>['char']; reg: ReturnType<typeof useStore>['reg']; onChange: (c: NonNullable<ReturnType<typeof useStore>['char']>) => void }) {
  const { t, tf } = useStore();
  if (!char) return null;
  const known = char.spellsKnown.includes(spell.id);
  const preparers = castersOf(char, reg).filter((c) => c.prepare).map((c) => c.classId);
  const prepClass = preparers.find((cl) => preparedSpellsOfClass(char, cl).includes(spell.id));
  const prepared = !!prepClass;
  const [slotLevel, setSlotLevel] = useState(Math.max(1, spell.level));
  const [prepClassSel, setPrepClassSel] = useState(preparers[0] ?? '');
  const castable = known;
  const slot = char.spellSlots[slotLevel];
  const maxKnown = maxSpellsKnown(char, reg);
  const atLimit = spell.level > 0 && maxKnown !== Infinity && !(char.houseRules?.bypassSpellLimit ?? false) && knownSpellCount(char, reg) >= maxKnown;
  const mat = materialText(spell);

  return (
    <tr>
      <td>{spell.name} {spell.source === 'custom' && <span className="tag custom">custom</span>}</td>
      <td>{spell.level === 0 ? t('sp.cantrip', 'trucchetto') : `${spell.level}°`}</td>
      <td className="muted">
        {spell.school}{spell.concentration ? ` · ${t('sp.concTag', 'conc.')}` : ''}{spell.ritual ? ` · ${t('sp.ritualTag', 'rituale')}` : ''}
        {mat && <div title={isMaterialConsumed(spell) ? 'componente consumato' : 'componente non consumato'}>M: {mat}</div>}
      </td>
      <td>
        {!known && (
          <button
            disabled={atLimit}
            title={atLimit ? tf('sp.limitTitle', 'Limite raggiunto ({a}/{b})', { a: knownSpellCount(char, reg), b: maxKnown }) : ''}
            onClick={() => {
              const r = addSpellKnown(char, spell.id, reg);
              if (r.error) alert(r.error);
              else onChange(r.character);
            }}
          >
            {t('sp.learn', 'Impara')}
          </button>
        )}
        {known && spell.level > 0 && (
          <button className="danger" style={{ marginLeft: 4 }} onClick={() => onChange(forgetSpell(char, spell.id).character)}>{t('sp.forget', 'Dimentica')}</button>
        )}
        {known && preparers.length > 0 && (
          <span className="row" style={{ display: 'inline-flex', marginLeft: 4 }}>
            {preparers.length > 1 && (
              <select value={prepClassSel} onChange={(e) => setPrepClassSel(e.target.value)} style={{ width: 110 }}>
                {preparers.map((cl) => <option key={cl} value={cl}>{reg.classes.get(cl)?.name ?? cl}</option>)}
              </select>
            )}
            <button
              onClick={() => {
                if (prepared) onChange(unprepareSpellForClass(char, spell.id, prepClass!));
                else {
                  const r = prepareSpellForClass(char, spell.id, preparers.length > 1 ? prepClassSel : preparers[0], reg);
                  if (r.error) alert(r.error);
                  else onChange(r.character);
                }
              }}
            >
              {prepared ? tf('sp.prepped', '✓ prep. ({cls})', { cls: reg.classes.get(prepClass!)?.name ?? prepClass }) : t('sp.prepare', 'prepara')}
            </button>
          </span>
        )}
        {castable && spell.level > 0 && (
          <span className="row" style={{ display: 'inline-flex', marginLeft: 6 }}>
            <select value={slotLevel} onChange={(e) => setSlotLevel(Number(e.target.value))} style={{ width: 60 }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].filter((l) => l >= spell.level).map((l) => (
                <option key={l} value={l}>{l}°</option>
              ))}
            </select>
            <button
              disabled={!slot || slot.used >= slot.total}
              onClick={() => {
                const r = castSpell(char, spell.id, slotLevel, reg);
                if (r.error) alert(r.error);
                else { if (r.warning) alert(r.warning); onChange(r.character); }
              }}
            >
              {t('sp.cast', 'Lancia')}
            </button>
            {spell.ritual && (
              <button
                title={t('sp.ritualTitle', 'Lancio rituale: +10 minuti, nessuno slot consumato')}
                onClick={() => {
                  const r = castSpellRitual(char, spell.id, reg);
                  if (r.error) alert(r.error);
                  else { if (r.warning) alert(r.warning); onChange(r.character); }
                }}
              >
                🕯 {t('sp.ritual', '🕯 rituale')}
              </button>
            )}
          </span>
        )}
        {castable && spell.level === 0 && <span className="muted" style={{ marginLeft: 6 }}>{t('sp.cantripFree', 'trucchetto (sempre lanciabile)')}</span>}
      </td>
    </tr>
  );
}

export default function SpellsTab() {
  const { reg, char, setChar, t, tf } = useStore();
  const [filter, setFilter] = useState('');
  if (!char) return null;

  const casters = castersOf(char, reg);
  const maxKnown = maxSpellsKnown(char, reg);
  const learnable = useMemo(() => learnableSpells(char, reg), [char, reg]);
  const known = char.spellsKnown.map((id) => reg.spells.get(id)).filter(Boolean) as SpellDef[];
  const q = filter.trim().toLowerCase();
  const shown = (q ? learnable.filter((s) => s.name.toLowerCase().includes(q)) : learnable)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  const slots = Object.entries(char.spellSlots)
    .map(([k, v]) => ({ level: Number(k), ...v }))
    .filter((s) => s.level <= 9 && s.total > 0)
    .sort((a, b) => a.level - b.level);

  return (
    <div className="grid">
      <div className="card">
        <h3>{t('sp.slots', 'Slot incantesimo')}</h3>
        {casters.length === 0 && <div className="muted">{t('sp.noCaster', 'Questo personaggio non lancia incantesimi.')}</div>}
        {casters.map((c) => (
          <div key={c.classId} className="muted" style={{ marginBottom: 6 }}>
            {tf('sp.casterLine', '{cls}: caratteristica {ab}, trucchetti conosciuti: {n}', { cls: reg.classes.get(c.classId)?.name ?? c.classId, ab: c.ability.toUpperCase(), n: c.cantripsKnown })}
          </div>
        ))}
        {casters.filter((c) => c.prepare).map((c) => {
          const prep = preparedSpellsOfClass(char, c.classId);
          if (prep.length === 0) return null;
          return (
            <div key={'prep-' + c.classId} className="muted" style={{ marginBottom: 4 }}>
              <b style={{ color: 'var(--text)' }}>{reg.classes.get(c.classId)?.name}</b> {tf('sp.prepares', 'prepara: {list}', { list: prep.map((id) => reg.spells.get(id)?.name ?? id).join(', ') })}
            </div>
          );
        })}
        {slots.length === 0 && casters.length > 0 && <div className="muted">{t('sp.noSlots', 'Nessuno slot disponibile a questo livello.')}</div>}
        <div>
          {slots.map((s) => (
            <span key={s.level} className="slot">
              <b>{s.level}°</b>
              {Array.from({ length: s.total }).map((_, i) => (
                <span key={i} className="tag" style={{ opacity: i < s.used ? 0.35 : 1 }}>{i < s.used ? '✕' : '●'}</span>
              ))}
            </span>
          ))}
        </div>
        {char.concentrationSpellId && (
          <div className="muted" style={{ marginTop: 6 }}>{tf('sp.concOn', 'Concentrazione su: {name}', { name: reg.spells.get(char.concentrationSpellId)?.name ?? char.concentrationSpellId })}</div>
        )}
      </div>

      <div className="card">
        <h3>
          {tf('sp.known', 'Incantesimi conosciuti ({n})', { n: known.length })}
          {maxKnown !== Infinity && (
            <span className="muted"> {tf('sp.knownLimit', '— non-trucchetti {a}/{b}{extra}', { a: knownSpellCount(char, reg), b: maxKnown, extra: (char.houseRules?.bypassSpellLimit ?? false) ? t('sp.limitIgnored', ' (limite ignorato)') : '' })}</span>
          )}
        </h3>
        {maxKnown !== Infinity && !(char.houseRules?.bypassSpellLimit ?? false) && knownSpellCount(char, reg) >= maxKnown && (
          <div className="error">{t('sp.limitHit', "Limite raggiunto: dimentica un incantesimo per imparne uno nuovo (o attiva l'house-rule).")}</div>
        )}
        {known.length === 0 && <div className="muted">{t('sp.noneKnown', 'Nessun incantesimo conosciuto.')}</div>}
        <table>
          <tbody>
            {known.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).map((s) => (
              <SpellRow key={s.id} spell={s} char={char} reg={reg} onChange={setChar} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>{t('sp.grimoire', 'Grimorio — impara nuovi incantesimi')}</h3>
        <input placeholder={t('sp.search', 'Cerca incantesimo...')} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 300, marginBottom: 8 }} />
        <table>
          <thead>
            <tr><th>{t('sp.thSpell', 'Incantesimo')}</th><th>{t('sp.thLevel', 'Liv.')}</th><th>{t('sp.thType', 'Tipo')}</th><th>{t('sp.thAction', 'Azione')}</th></tr>
          </thead>
          <tbody>
            {shown.slice(0, 200).map((s) => (
              <SpellRow key={s.id} spell={s} char={char} reg={reg} onChange={setChar} />
            ))}
          </tbody>
        </table>
        {shown.length > 200 && <div className="muted">{tf('sp.moreResults', '…{n} risultati in più: affina la ricerca.', { n: shown.length - 200 })}</div>}
      </div>
    </div>
  );
}
