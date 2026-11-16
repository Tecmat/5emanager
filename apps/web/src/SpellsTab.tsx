import { useMemo, useState } from 'react';
import {
  addSpellKnown,
  castersOf,
  castSpell,
  forgetSpell,
  knownSpellCount,
  learnableSpells,
  maxSpellsKnown,
  prepareSpell,
  type SpellDef,
} from '@dnd5e/core';
import { useStore } from './store.js';

function SpellRow({ spell, char, reg, onChange }: { spell: SpellDef; char: ReturnType<typeof useStore>['char']; reg: ReturnType<typeof useStore>['reg']; onChange: (c: NonNullable<ReturnType<typeof useStore>['char']>) => void }) {
  if (!char) return null;
  const known = char.spellsKnown.includes(spell.id);
  const prepared = char.spellsPrepared.includes(spell.id);
  const [slotLevel, setSlotLevel] = useState(Math.max(1, spell.level));
  const castable = known;
  const slot = char.spellSlots[slotLevel];
  const maxKnown = maxSpellsKnown(char, reg);
  const atLimit = spell.level > 0 && maxKnown !== Infinity && !char.houseRules.bypassSpellLimit && knownSpellCount(char, reg) >= maxKnown;

  return (
    <tr>
      <td>{spell.name} {spell.source === 'custom' && <span className="tag custom">custom</span>}</td>
      <td>{spell.level === 0 ? 'trucchetto' : `${spell.level}°`}</td>
      <td className="muted">{spell.school}{spell.concentration ? ' · conc.' : ''}{spell.ritual ? ' · rituale' : ''}</td>
      <td>
        {!known && (
          <button
            disabled={atLimit}
            title={atLimit ? `Limite raggiunto (${knownSpellCount(char, reg)}/${maxKnown})` : ''}
            onClick={() => {
              const r = addSpellKnown(char, spell.id, reg);
              if (r.error) alert(r.error);
              else onChange(r.character);
            }}
          >
            Impara
          </button>
        )}
        {known && spell.level > 0 && (
          <button className="danger" style={{ marginLeft: 4 }} onClick={() => onChange(forgetSpell(char, spell.id).character)}>Dimentica</button>
        )}
        {known && castersOf(char, reg).some((c) => c.prepare) && (
          <button onClick={() => onChange(prepareSpell(char, spell.id, reg).character)}>{prepared ? '✓ preparato' : 'prepara'}</button>
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
                else onChange(r.character);
              }}
            >
              Lancia
            </button>
          </span>
        )}
        {castable && spell.level === 0 && <span className="muted" style={{ marginLeft: 6 }}>trucchetto (sempre lanciabile)</span>}
      </td>
    </tr>
  );
}

export default function SpellsTab() {
  const { reg, char, setChar } = useStore();
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
        <h3>Slot incantesimo</h3>
        {casters.length === 0 && <div className="muted">Questo personaggio non lancia incantesimi.</div>}
        {casters.map((c) => (
          <div key={c.classId} className="muted" style={{ marginBottom: 6 }}>
            {reg.classes.get(c.classId)?.name}: caratteristica {c.ability.toUpperCase()}, trucchetti conosciuti: {c.cantripsKnown}
          </div>
        ))}
        {slots.length === 0 && casters.length > 0 && <div className="muted">Nessuno slot disponibile a questo livello.</div>}
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
          <div className="muted" style={{ marginTop: 6 }}>Concentrazione su: <b>{reg.spells.get(char.concentrationSpellId)?.name}</b></div>
        )}
      </div>

      <div className="card">
        <h3>
          Incantesimi conosciuti ({known.length})
          {maxKnown !== Infinity && (
            <span className="muted"> — non-trucchetti {knownSpellCount(char, reg)}/{maxKnown}{char.houseRules.bypassSpellLimit ? ' (limite ignorato)' : ''}</span>
          )}
        </h3>
        {maxKnown !== Infinity && !char.houseRules.bypassSpellLimit && knownSpellCount(char, reg) >= maxKnown && (
          <div className="error">Limite raggiunto: dimentica un incantesimo per imparne uno nuovo (o attiva l'house-rule).</div>
        )}
        {known.length === 0 && <div className="muted">Nessun incantesimo conosciuto.</div>}
        <table>
          <tbody>
            {known.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).map((s) => (
              <SpellRow key={s.id} spell={s} char={char} reg={reg} onChange={setChar} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Grimorio — impara nuovi incantesimi</h3>
        <input placeholder="Cerca incantesimo..." value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 300, marginBottom: 8 }} />
        <table>
          <thead>
            <tr><th>Incantesimo</th><th>Liv.</th><th>Tipo</th><th>Azione</th></tr>
          </thead>
          <tbody>
            {shown.slice(0, 200).map((s) => (
              <SpellRow key={s.id} spell={s} char={char} reg={reg} onChange={setChar} />
            ))}
          </tbody>
        </table>
        {shown.length > 200 && <div className="muted">…{shown.length - 200} risultati in più: affina la ricerca.</div>}
      </div>
    </div>
  );
}
