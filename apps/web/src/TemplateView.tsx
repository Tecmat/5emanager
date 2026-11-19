import type { CombatTemplate } from '@dnd5e/core';

/**
 * Vista SVG di un template area (cono/sfera/linea/cubo) su griglia 5 ft.
 * Le misure sono in piedi: sizeFt = lunghezza (cono/linea), raggio (sfera), lato (cubo).
 */
export default function TemplateView({ tpl, cellPx = 26 }: { tpl: CombatTemplate; cellPx?: number }) {
  const c = cellPx; // px per cella da 5 ft
  const px = (ft: number) => (ft / 5) * c;
  const m = c; // margine di una cella
  let w = 0;
  let h = 0;
  let body: React.ReactNode = null;
  const fill = 'var(--accent2)';
  const stroke = 'var(--accent)';
  if (tpl.shape === 'cone') {
    w = px(tpl.sizeFt); h = px(tpl.sizeFt);
    body = <polygon points={`${w / 2},${h} 0,0 ${w},0`} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={2} />;
  } else if (tpl.shape === 'sphere') {
    w = px(tpl.sizeFt * 2); h = w;
    body = <circle cx={w / 2} cy={h / 2} r={px(tpl.sizeFt)} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={2} />;
  } else if (tpl.shape === 'line') {
    w = px(tpl.sizeFt); h = px(tpl.widthFt ?? 5);
    body = <rect x={0} y={0} width={w} height={h} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={2} />;
  } else {
    w = px(tpl.sizeFt); h = w;
    body = <rect x={0} y={0} width={w} height={h} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={2} />;
  }
  // griglia 5 ft
  const lines: React.ReactNode[] = [];
  for (let x = 0; x <= w + 0.01; x += c) lines.push(<line key={'v' + x} x1={x} y1={0} x2={x} y2={h} stroke="var(--border)" strokeWidth={1} />);
  for (let y = 0; y <= h + 0.01; y += c) lines.push(<line key={'h' + y} x1={0} y1={y} x2={w} y2={y} stroke="var(--border)" strokeWidth={1} />);
  // origine (apice cono / centro sfera / angolo linea-cubo)
  const ox = tpl.shape === 'cone' ? w / 2 : tpl.shape === 'sphere' ? w / 2 : 0;
  const oy = tpl.shape === 'cone' ? h : tpl.shape === 'sphere' ? h / 2 : 0;
  return (
    <svg
      viewBox={`${-m} ${-m} ${w + 2 * m} ${h + 2 * m}`}
      style={{ maxWidth: '100%', height: 'auto', maxHeight: 320, background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8 }}
      role="img"
      aria-label={tpl.label ?? tpl.shape}
    >
      {lines}
      {body}
      <circle cx={ox} cy={oy} r={c / 5} fill="var(--danger)" />
      {tpl.label && (
        <text x={w / 2} y={-m / 3} textAnchor="middle" fontSize={c / 2.2} fill="var(--text)">
          {tpl.label} · 1 cella = 5 ft
        </text>
      )}
    </svg>
  );
}
