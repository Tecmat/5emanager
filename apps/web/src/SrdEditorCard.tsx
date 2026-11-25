import { useEffect, useMemo, useState } from 'react';
import { SRD_DATA } from '@dnd5e/data-srd';
import { useStore } from './store.js';
import Icon from './icons.js';
import {
  OVERRIDE_CATEGORIES,
  exportOverrides,
  importOverrides,
  loadOverrides,
  removeOverride,
  saveOverrides,
  upsertOverride,
  validateOverrideEntry,
  type OverrideCategory,
  type SrdOverrides,
} from './srdOverrides.js';

/**
 * Editor delle regole base (SRD): scegli categoria + elemento, modifichi il JSON e salvi
 * come override persistente (localStorage), applicato sopra l'SRD nel registry.
 * Utile per rifinire nomi/descrizioni/traduzioni delle regole base senza toccare il pacchetto.
 * Esporta/importa gli override in JSON; "Ripristina" torna all'SRD originale.
 */
export default function SrdEditorCard() {
  const { t, srdOverrideCount, reloadSrdOverrides } = useStore();
  const [cat, setCat] = useState<OverrideCategory>('spells');
  const [filter, setFilter] = useState('');
  const [selId, setSelId] = useState('');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [overrides, setOverrides] = useState<SrdOverrides>({});

  useEffect(() => { loadOverrides().then(setOverrides).catch(() => {}); }, [srdOverrideCount]);

  const entries = useMemo(() => {
    const list = (SRD_DATA[cat] ?? []) as { id: string; name?: string }[];
    const f = filter.trim().toLowerCase();
    const withOv = list.map((e) => ({ ...e, overridden: !!overrides[cat]?.[e.id] }));
    return f ? withOv.filter((e) => (e.name ?? e.id).toLowerCase().includes(f) || e.id.includes(f)) : withOv;
  }, [cat, filter, overrides]);

  const pick = (id: string) => {
    setSelId(id);
    setMsg(null);
    const base = (SRD_DATA[cat] as { id: string }[]).find((e) => e.id === id) as Record<string, unknown> | undefined;
    const ov = overrides[cat]?.[id];
    setText(JSON.stringify(ov ?? base ?? {}, null, 2));
  };

  const save = async () => {
    setMsg(null);
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(text); } catch (e) { setMsg({ kind: 'error', text: 'JSON non valido: ' + (e as Error).message }); return; }
    const verr = validateOverrideEntry(cat, entry);
    if (verr) { setMsg({ kind: 'error', text: verr }); return; }
    const next = upsertOverride(overrides, cat, entry);
    if (!(await saveOverrides(next))) { setMsg({ kind: 'error', text: 'archiviazione piena' }); return; }
    setOverrides(next);
    reloadSrdOverrides();
    setMsg({ kind: 'ok', text: `${t('srd.saved', 'Salvato (override attivo)')}: ${String(entry.id)}` });
  };

  const resetEntry = async () => {
    if (!selId) return;
    const next = removeOverride(overrides, cat, selId);
    await saveOverrides(next);
    setOverrides(next);
    reloadSrdOverrides();
    pick(selId); // ricarica il testo dall'SRD originale
    setMsg({ kind: 'ok', text: `Ripristinato l'originale SRD di ${selId}` });
  };

  const doExport = () => {
    const blob = new Blob([exportOverrides(overrides)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '5emanager-srd-overrides.json';
    a.click();
  };

  const doImport = async (f: File) => {
    const json = await f.text();
    const r = importOverrides(json);
    if (r.error || !r.data) { setMsg({ kind: 'error', text: r.error ?? 'importo fallito' }); return; }
    const base = await loadOverrides().catch(() => ({} as SrdOverrides));
    const next: SrdOverrides = { ...base };
    for (const c of OVERRIDE_CATEGORIES) {
      if (r.data[c.id]) next[c.id] = { ...(base[c.id] ?? {}), ...r.data[c.id] };
    }
    await saveOverrides(next);
    setOverrides(next);
    reloadSrdOverrides();
    setMsg({ kind: 'ok', text: `${r.count} ${t('srd.imported', 'override importati')}` });
  };

  const clearAll = async () => {
    if (!window.confirm(t('srd.clearConfirm', 'Rimuovere TUTTI gli override delle regole base? Torna tutto all\'SRD originale.'))) return;
    await saveOverrides({});
    setOverrides({});
    reloadSrdOverrides();
    setText('');
    setMsg({ kind: 'ok', text: 'Tutti gli override rimossi' });
  };

  return (
    <div className="card">
      <h3><Icon name="pencil" candy size={16} /> {t('srd.title', 'Editor regole base (SRD)')}</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('srd.hint', 'Modifica le regole base (nomi, descrizioni, traduzioni) senza toccare il pacchetto: gli override sono salvati in locale e applicati sopra l\'SRD. Esporta/importa il JSON per portarli altrove.')}
        {' '}<b>{srdOverrideCount} {t('srd.count', 'override attivi')}</b>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <select value={cat} onChange={(e) => { setCat(e.target.value as OverrideCategory); setSelId(''); setText(''); setFilter(''); }}>
          {OVERRIDE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('srd.filterPh', 'Filtra per nome o id…')} style={{ flex: 1, minWidth: 160 }} />
        <select value={selId} onChange={(e) => pick(e.target.value)} style={{ minWidth: 200 }}>
          <option value="">{t('srd.pick', '— scegli un elemento…')}</option>
          {entries.map((e) => <option key={e.id} value={e.id}>{(e as { overridden?: boolean }).overridden ? '✏️ ' : ''}{(e.name ?? e.id)}</option>)}
        </select>
      </div>
      {selId && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            style={{ width: '100%', minHeight: 220, fontFamily: 'monospace', fontSize: 12, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}
          />
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
            <button className="primary" onClick={save}>💾 {t('srd.save', 'Salva override')}</button>
            <button onClick={resetEntry} title={t('srd.resetTitle', 'Elimina l\'override di questo elemento: torna all\'SRD originale')}>↩️ {t('srd.reset', 'Ripristina originale')}</button>
            <button onClick={doExport}>📤 {t('srd.export', 'Esporta JSON')}</button>
            <label className="row" style={{ gap: 6, fontSize: 13, cursor: 'pointer' }}>
              📥 {t('srd.import', 'Importa JSON')}
              <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ''; }} />
            </label>
            <button className="danger" onClick={clearAll}>{t('srd.clear', 'Rimuovi tutti')}</button>
          </div>
        </>
      )}
      {msg && <div className={msg.kind === 'ok' ? 'ok' : 'error'} style={{ marginTop: 8 }}>{msg.text}</div>}
    </div>
  );
}
