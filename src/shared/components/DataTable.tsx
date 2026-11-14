import type { Cell } from '@/insights/schema';

export interface TableColumn { name: string; label: string }

const show = (v: Cell | undefined) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v === null || v === undefined ? '–' : String(v));

/** The numbers behind a chart (first 200 rows). */
export function DataTable({ columns, rows }: { columns: TableColumn[]; rows: Array<Record<string, Cell>> }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-[10px] border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-sky text-left text-ink-soft">
          <tr>{columns.map((c) => <th key={c.name} scope="col" className="px-3 py-2 font-semibold">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={i} className="border-t border-line">
              {columns.map((c) => (
                <td key={c.name} className={`px-3 py-1.5 ${typeof r[c.name] === 'number' ? 'text-right tabular-nums' : ''}`}>{show(r[c.name])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
