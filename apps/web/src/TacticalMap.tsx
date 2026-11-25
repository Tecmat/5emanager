import { useEffect, useRef, useState } from 'react';
import type { CombatState, Combatant } from '@dnd5e/core';
import { ensureMap } from '@dnd5e/core';
import { useStore } from './store.js';

/**
 * Mappa tattica del combattimento: griglia cols x rows (1 cella = 5 ft) con un token
 * trascinabile per ogni combattente. Lo stato vive in `combat.map` e arriva via `state`,
 * quindi si sincronizza da solo su server WS e P2P. Chi puo' muovere e' deciso dal chiamante
 * (`canMove`): il master sempre, il PG solo il proprio token nel suo turno.
 */
export default function TacticalMap({
  combat,
  canMove,
  onMove,
  cellPx = 30,
  onResize,
  canResize = false,
  currentTurnId,
}: {
  combat: CombatState;
  canMove: (tokenId: string) => boolean;
  onMove: (tokenId: string, x: number, y: number) => void;
  cellPx?: number;
  onResize?: (cols: number, rows: number) => void;
  canResize?: boolean;
  currentTurnId?: string;
}) {
  const { t } = useStore();
  const m = ensureMap(combat).map!;
  const c = cellPx;
  const W = m.cols * c;
  const H = m.rows * c;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  // vista (zoom/pan): null = quadro intero. In coordinate "mappa" (0..W, 0..H)
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; v0: { x: number; y: number; w: number; h: number }; mid0: { x: number; y: number } } | null>(null);

  // reset della vista quando cambia la dimensione della griglia
  useEffect(() => { setView(null); }, [W, H]);

  // zoom con la rotella del mouse (intorno al cursore)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM()?.inverse());
      setView((v) => {
        const cur = v ?? { x: 0, y: 0, w: W, h: H };
        const w = Math.max(W / 8, Math.min(W * 2, cur.w * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
        const h = w * (cur.h / cur.w);
        const k = w / rect.width;
        return { x: loc.x - (e.clientX - rect.left) * k, y: loc.y - (e.clientY - rect.top) * k, w, h };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [W, H]);

  /** clientX/Y -> coordinate della viewBox (valide anche con zoom/pan) */
  const toMap = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM()?.inverse());
  };

  const cellFromEvent = (e: React.PointerEvent): { x: number; y: number } | null => {
    const loc = toMap(e.clientX, e.clientY);
    if (!loc) return null;
    return {
      x: Math.max(0, Math.min(m.cols - 1, Math.floor(loc.x / c))),
      y: Math.max(0, Math.min(m.rows - 1, Math.floor(loc.y / c))),
    };
  };

  const lines: React.ReactNode[] = [];
  for (let x = 0; x <= m.cols; x++) lines.push(<line key={'v' + x} x1={x * c} y1={0} x2={x * c} y2={H} stroke="var(--border)" strokeWidth={x % 2 === 0 ? 1 : 0.5} />);
  for (let y = 0; y <= m.rows; y++) lines.push(<line key={'h' + y} x1={0} y1={y * c} x2={W} y2={y * c} stroke="var(--border)" strokeWidth={y % 2 === 0 ? 1 : 0.5} />);

  const tokenOf = (cb: Combatant) => m.tokens[cb.id] ?? { x: 0, y: 0 };
  const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();
  const curView = view ?? { x: 0, y: 0, w: W, h: H };

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={view ? `${view.x} ${view.y} ${view.w} ${view.h}` : `0 0 ${W} ${H}`}
        style={{ maxWidth: '100%', height: 'auto', maxHeight: 420, background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, touchAction: 'none', userSelect: 'none' }}
        role="img"
        aria-label={t('cb.mapAria', 'Mappa tattica')}
        onPointerDown={(e) => {
          svgRef.current?.setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            // due dita: pinch-zoom + pan, niente più trascinamento token
            setDrag(null);
            setGhost(null);
            const [a, b] = [...pointers.current.values()];
            pinch.current = {
              d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
              v0: curView,
              mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            };
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          // pinch con due dita: zoom intorno al punto medio + pan
          if (pinch.current && pointers.current.size >= 2) {
            const svg = svgRef.current;
            if (!svg) return;
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const { d0, v0, mid0 } = pinch.current;
            const rect = svg.getBoundingClientRect();
            const w = Math.max(W / 8, Math.min(W * 2, v0.w * (d0 / Math.max(1, d))));
            const h = w * (v0.h / v0.w);
            // tieni fisso il punto di mappa sotto il centro delle dita
            const mx0 = v0.x + (mid0.x - rect.left) * (v0.w / rect.width);
            const my0 = v0.y + (mid0.y - rect.top) * (v0.h / rect.height);
            setView({
              x: mx0 - (mid.x - rect.left) * (w / rect.width),
              y: my0 - (mid.y - rect.top) * (h / rect.height),
              w,
              h,
            });
            return;
          }
          if (drag) {
            const cell = cellFromEvent(e);
            if (cell) setGhost({ id: drag, ...cell });
            return;
          }
          // un dito sullo sfondo: pan della vista
          if (prev && pointers.current.size === 1) {
            const svg = svgRef.current;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const f = curView.w / rect.width;
            const dx = (e.clientX - prev.x) * f;
            const dy = (e.clientY - prev.y) * f;
            if (Math.abs(dx) + Math.abs(dy) < 0.5 && !view) return; // non zoommato: niente pan
            setView({
              x: Math.max(-W / 2, Math.min(W, curView.x - dx)),
              y: Math.max(-H / 2, Math.min(H, curView.y - dy)),
              w: curView.w,
              h: curView.h,
            });
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (drag) {
            const cell = cellFromEvent(e);
            if (cell) onMove(drag, cell.x, cell.y);
            setDrag(null);
            setGhost(null);
          }
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (drag) { setDrag(null); setGhost(null); }
        }}
      >
        {lines}
        {combat.combatants.map((cb) => {
          const t = ghost?.id === cb.id ? ghost : tokenOf(cb);
          const cx = t.x * c + c / 2;
          const cy = t.y * c + c / 2;
          const isTurn = cb.id === currentTurnId;
          const movable = canMove(cb.id);
          const hpRatio = cb.maxHp > 0 ? cb.hp / cb.maxHp : 1;
          const fill = cb.isPlayer ? 'var(--accent)' : 'var(--danger)';
          return (
            <g
              key={cb.id}
              style={{ cursor: movable ? 'grab' : 'default', opacity: drag === cb.id ? 0.5 : 1 }}
              onPointerDown={(e) => {
                if (!movable) return;
                e.preventDefault();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setDrag(cb.id);
              }}
            >
              {isTurn && <circle cx={cx} cy={cy} r={c * 0.48} fill="none" stroke="var(--warn)" strokeWidth={2} strokeDasharray="4 3" />}
              <circle cx={cx} cy={cy} r={c * 0.38} fill={fill} fillOpacity={hpRatio < 1 ? 0.55 : 0.9} stroke="var(--text)" strokeOpacity={0.4} strokeWidth={1} />
              <text x={cx} y={cy + c * 0.14} textAnchor="middle" fontSize={c * 0.42} fontWeight="bold" fill="#fff" pointerEvents="none">
                {initial(cb.name)}
              </text>
              <text x={cx} y={cy + c * 0.62} textAnchor="middle" fontSize={c * 0.26} fill="var(--text)" pointerEvents="none">
                {cb.name.length > 12 ? cb.name.slice(0, 11) + '…' : cb.name} · {cb.hp}/{cb.maxHp}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap', gap: 8 }}>
        <span>{t('cb.mapHint', '1 cella = 5 ft · trascina i token · pizzica/rotella per zoom · un dito per spostare la vista')}</span>
        {view && (
          <button onClick={() => setView(null)} title={t('cb.mapReset', 'Torna alla vista intera della mappa')} style={{ fontSize: 12, padding: '2px 8px' }}>
            ⟲ {t('cb.mapResetBtn', 'vista intera')}
          </button>
        )}
        {canResize && onResize && (
          <select
            value={`${m.cols}x${m.rows}`}
            onChange={(e) => { const [cc, rr] = e.target.value.split('x').map(Number); onResize(cc, rr); }}
            title={t('cb.mapSizeTitle', 'Dimensione della griglia (celle da 5 ft)')}
          >
            <option value="12x9">12×9</option>
            <option value="16x12">16×12</option>
            <option value="24x16">24×16</option>
            <option value="32x20">32×20</option>
          </select>
        )}
      </div>
    </div>
  );
}
