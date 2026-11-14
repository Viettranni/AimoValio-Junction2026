'use client';

import { useState } from 'react';
import type { Answer } from '@/insights/analyst';
import { DataTable } from '@/shared/components/DataTable';
import { VegaChart } from '@/shared/components/VegaChart';

const STEP_WORDS: Record<string, string> = {
  start_analysis: 'Opened your data', describe_data: 'Looked at what can be asked', get_values: 'Checked the values', run_query: 'Asked the question',
  suggest_chart: 'Picked the chart types that fit', build_chart: 'Drew the chart', explain_result: 'Wrote the summary',
};

/** Caption, chart or table, three facts, and "How I made this" (the rail steps taken). */
export function AnswerCard({ answer }: { answer: Answer }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [steps, setSteps] = useState(false);
  const seg = (v: 'chart' | 'table', label: string) => (
    <button type="button" aria-pressed={view === v} onClick={() => setView(v)}
      className={`rounded-full px-3 py-1 ${view === v ? 'bg-navy text-[var(--ik-surface)]' : 'text-muted'}`}>{label}</button>
  );
  return (
    <article className="ik-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">{answer.caption}</h2>
          {answer.assumed.length > 0 && <p className="mt-1 text-[13px] text-muted">{answer.assumed.join(' ')}</p>}
          {answer.note && <p className="mt-1 text-[12.5px] text-muted">{answer.note}</p>}
        </div>
        <div role="group" aria-label="Show as" className="inline-flex rounded-full border border-line p-0.5 text-[12.5px]">{seg('chart', 'Chart')}{seg('table', 'Table')}</div>
      </div>
      <div className="mt-4">
        {view === 'table' || !answer.chart ? <DataTable columns={answer.columns} rows={answer.rows} /> : <VegaChart spec={answer.chart} />}
      </div>
      <ul className="mt-4 grid gap-2 md:grid-cols-3">
        {answer.facts.map((f) => <li key={f} className="ik-raised rounded-[10px] px-3 py-2 text-[13.5px] text-ink-soft">{f}</li>)}
      </ul>
      <button type="button" className="mt-4 text-[13px] font-semibold text-navy underline" aria-expanded={steps} onClick={() => setSteps(!steps)}>How I made this</button>
      {steps && (
        <>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-ink-soft">
            {answer.steps.map((s, i) => (
              <li key={i}><b>{STEP_WORDS[s.tool] ?? s.tool}</b>
                {s.tool === 'run_query' && <small className="block break-all font-mono text-[11.5px] text-muted">{JSON.stringify(s.args)}</small>}
                {s.error && <small className="block text-warn">Fixed: {String(s.error.message)}</small>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[12.5px] text-muted">
            {answer.engine === 'claude' ? 'Answered by Claude Haiku using the insight tools.' : 'Answered by the built-in rules using the insight tools.'} Any agent can call the same tools over the API.
          </p>
        </>
      )}
    </article>
  );
}
