import { useRef, useState } from 'react';
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

  const cellFromEvent = (e: React.PointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM()?.inverse());
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

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ maxWidth: '100%', height: 'auto', maxHeight: 420, background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, touchAction: 'none', userSelect: 'none' }}
        role="img"
        aria-label={t('cb.mapAria', 'Mappa tattica')}
        onPointerMove={(e) => {
          if (!drag) return;
          const cell = cellFromEvent(e);
          if (cell) setGhost({ id: drag, ...cell });
        }}
        onPointerUp={(e) => {
          if (!drag) return;
          const cell = cellFromEvent(e);
          if (cell) onMove(drag, cell.x, cell.y);
          setDrag(null);
          setGhost(null);
        }}
        onPointerLeave={() => { if (drag) { setDrag(null); setGhost(null); } }}
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
        <span>{t('cb.mapHint', '1 cella = 5 ft · trascina i token')}</span>
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
