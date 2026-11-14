'use client';

import { useEffect, useRef } from 'react';
import type { ChartSpec } from '@/insights/charts';
import type { Cell } from '@/insights/schema';
import { useTheme } from '../hooks/useTheme';
import { useVegaEmbed } from '../hooks/useVegaEmbed';
import { DataTable, type TableColumn } from './DataTable';

/** The page's light/dark theme as Vega-Lite config (specs carry no colours). */
function vegaConfig(el: Element) {
  const css = (n: string) => getComputedStyle(el).getPropertyValue(n).trim();
  const cat = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--ik-cat-${i}`));
  const seq = [css('--ik-seq-1'), css('--ik-seq-2'), css('--ik-seq-3')];
  const font = 'Inter, system-ui, sans-serif';
  return {
    background: null, font, padding: 4, view: { stroke: null },
    axis: { labelColor: css('--muted'), titleColor: css('--muted'), gridColor: css('--line'), domainColor: css('--line'), tickColor: css('--line'),
      labelFontSize: 12, titleFontSize: 12, titleFontWeight: 500, gridOpacity: 0.7 },
    legend: { labelColor: css('--ink'), titleColor: css('--muted'), labelFontSize: 12, titleFontSize: 12, orient: 'bottom', symbolType: 'circle' },
    title: { color: css('--ink'), fontSize: 14, fontWeight: 600, anchor: 'start' },
    range: { category: cat, ordinal: { scheme: 'teals' }, ramp: seq, heatmap: seq },
    mark: { color: cat[0] }, bar: { color: cat[0] }, line: { color: cat[0] }, point: { color: cat[0], size: 50, filled: true },
    area: { color: cat[0] }, arc: { stroke: css('--ik-surface'), strokeWidth: 2 }, rect: { stroke: css('--ik-surface'), strokeWidth: 2 },
    text: { color: css('--ink'), font },
    style: { anomaly: { stroke: css('--ik-surface') } }, // unusual periods: a surface ring keeps them legible on the line
  };
}

const cells = (v: unknown): Array<Record<string, Cell>> =>
  Array.isArray(v) ? v.filter((r): r is Record<string, Cell> => typeof r === 'object' && r !== null) : [];
const tableColumns = (v: unknown): TableColumn[] =>
  Array.isArray(v) ? v.flatMap((c) => (typeof c === 'object' && c !== null && 'name' in c && 'label' in c ? [{ name: String(c.name), label: String(c.label) }] : [])) : [];

/** Draws a gateway chart spec; a table spec, or no chart runtime, shows the numbers as a table. */
export function VegaChart({ spec, height }: { spec: ChartSpec; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { embed, failed } = useVegaEmbed();
  const { theme } = useTheme();
  const isTable = spec.type === 'table';

  useEffect(() => {
    const el = ref.current;
    if (!el || !embed || isTable) return;
    let view: { finalize: () => void } | null = null;
    let alive = true;
    const root = el.closest('.ik-root') ?? el;
    const s: Record<string, unknown> = { ...spec, autosize: { type: 'fit-x', contains: 'padding' },
      config: { ...vegaConfig(root), ...(typeof spec.config === 'object' && spec.config !== null ? spec.config : {}) },
      ...(height ? { height } : {}) };
    // a frame later, so the theme attribute is applied before colours are read
    const frame = requestAnimationFrame(() => {
      embed(el, s, { actions: false, renderer: 'svg' })
        .then((r) => { if (alive) view = r; else r.finalize(); })
        .catch((e: unknown) => console.warn('Chart could not be drawn:', e));
    });
    return () => { alive = false; cancelAnimationFrame(frame); view?.finalize(); };
  }, [embed, spec, height, theme, isTable]);

  if (isTable || failed) {
    const data = isTable ? spec : spec.data;
    const rows = cells(isTable ? spec.rows : typeof data === 'object' && data !== null && 'values' in data ? data.values : []);
    const columns = isTable ? tableColumns(spec.columns) : Object.keys(rows[0] ?? {}).map((n) => ({ name: n, label: n }));
    return <DataTable columns={columns} rows={rows} />;
  }
  return <div ref={ref} className="ik-chart" />;
}
