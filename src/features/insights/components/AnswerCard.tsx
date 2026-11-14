'use client';

import { useState } from 'react';
import type { Answer } from '@/insights/analyst';
import { DataTable } from '@/shared/components/DataTable';
import { VegaChart } from '@/shared/components/VegaChart';

const STEP_WORDS: Record<string, string> = {
  start_analysis: 'Avasi datasi', describe_data: 'Katsoi, mitä voi kysyä', get_values: 'Tarkisti arvot', run_query: 'Kysyi kysymyksen',
  suggest_chart: 'Valitsi sopivat kaaviotyypit', build_chart: 'Piirsi kaavion', explain_result: 'Kirjoitti yhteenvedon',
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
        <div role="group" aria-label="Näytä muodossa" className="inline-flex rounded-full border border-line p-0.5 text-[12.5px]">{seg('chart', 'Kaavio')}{seg('table', 'Taulukko')}</div>
      </div>
      <div className="mt-4">
        {view === 'table' || !answer.chart ? <DataTable columns={answer.columns} rows={answer.rows} /> : <VegaChart spec={answer.chart} />}
      </div>
      <ul className="mt-4 grid gap-2 md:grid-cols-3">
        {answer.facts.map((f) => <li key={f} className="ik-raised rounded-[10px] px-3 py-2 text-[13.5px] text-ink-soft">{f}</li>)}
      </ul>
      <button type="button" className="mt-4 text-[13px] font-semibold text-navy underline" aria-expanded={steps} onClick={() => setSteps(!steps)}>Näin tämä tehtiin</button>
      {steps && (
        <>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-ink-soft">
            {answer.steps.map((s, i) => (
              <li key={i}><b>{STEP_WORDS[s.tool] ?? s.tool}</b>
                {s.tool === 'run_query' && <small className="block break-all font-mono text-[11.5px] text-muted">{JSON.stringify(s.args)}</small>}
                {s.error && <small className="block text-warn">Korjattu: {String(s.error.message)}</small>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[12.5px] text-muted">
            {answer.engine === 'claude' ? 'Vastannut Claude Haiku analytiikkatyökaluilla.' : 'Vastannut sisäänrakennettu sääntömoottori analytiikkatyökaluilla.'} Mikä tahansa agentti voi kutsua samoja työkaluja rajapinnan kautta.
          </p>
        </>
      )}
    </article>
  );
}
