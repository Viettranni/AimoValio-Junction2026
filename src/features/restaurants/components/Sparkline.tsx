import { sparkPoints } from '../model/format';

export function Sparkline({ values, w = 120, h = 34 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const pts = sparkPoints({ values, w, h });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="Kulutus 12 kuukauden ajalta">
      <polygon points={`${pts[0][0]},${h} ${line} ${lx},${h}`} fill="var(--sky)" />
      <polyline points={line} fill="none" stroke="var(--navy)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3.5" fill="var(--navy)" />
    </svg>
  );
}
