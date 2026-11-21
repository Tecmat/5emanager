import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store.js';
import Icon from './icons.js';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Palette comandi (Ctrl/Cmd+K): filtro testuale + navegación da tastiera (↑↓, Invio, Esc).
 */
export default function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const { t } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(needle) || (c.hint ?? '').toLowerCase().includes(needle));
  }, [q, commands]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setSel(0);
  }, [q]);
  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = filtered[sel];
      if (c) {
        onClose();
        c.run();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="modal-bg" role="dialog" aria-label={t('cmd.title', 'Comandi rapidi')} onClick={onClose}>
      <div
        className="card"
        style={{ maxWidth: 480, width: '92vw', padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('cmd.ph', 'Cerca un comando… (↑↓ seleziona, Invio esegui, Esc chiudi)')}
            style={{ flex: 1, border: 'none', background: 'transparent' }}
            aria-label={t('cmd.ph', 'Cerca un comando')}
          />
          <span className="tag">esc</span>
        </div>
        <div ref={listRef} style={{ maxHeight: 320, overflow: 'auto' }}>
          {filtered.length === 0 && <div className="muted" style={{ padding: 12 }}>{t('cmd.empty', 'Nessun comando trovato')}</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className="cmdk-item"
              style={{ background: i === sel ? 'var(--panel2)' : 'transparent' }}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                onClose();
                c.run();
              }}
            >
              <span>{c.label}</span>
              {c.hint && <span className="muted" style={{ fontSize: 11 }}>{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
