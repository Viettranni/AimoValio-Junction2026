'use client';

import { useState } from 'react';
import type { Clarify } from '@/insights/analyst';
import type { ClarifyState } from '../hooks/useInsights';

const chip = (on: boolean) => `rounded-full border px-3 py-1 text-[13px] ${on ? 'border-navy bg-navy text-[var(--ik-surface)]' : 'border-line text-navy'}`;

/** The analyst asks back: quick answers per question, or a custom one. */
export function ClarifyCard({ answer, clar, setClar, onSend }: {
  answer: Clarify; clar: ClarifyState; setClar: (c: ClarifyState) => void; onSend: () => void;
}) {
  const [draft, setDraft] = useState('');
  const pick = (i: number, v: string) => setClar({ ...clar, answers: { ...clar.answers, [i]: v } });
  return (
    <article className="ik-card p-5">
      <h2 className="text-[16px] font-semibold text-ink">Vielä muutama tarkennus</h2>
      <p className="mt-1 text-[13.5px] text-ink-soft">{answer.intro}</p>
      <div className="mt-4 space-y-3">
        {answer.questions.map((q, i) => {
          const own = clar.answers[i] && !q.options.includes(clar.answers[i]);
          return (
            <div key={q.q}>
              <p className="text-[13.5px] text-ink">{q.q}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {q.options.map((o) => <button key={o} type="button" className={chip(clar.answers[i] === o)} aria-pressed={clar.answers[i] === o} onClick={() => pick(i, o)}>{o}</button>)}
                {clar.custom === i ? (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) pick(i, draft.trim()); setClar({ answers: { ...clar.answers, ...(draft.trim() ? { [i]: draft.trim() } : {}) }, custom: null }); setDraft(''); }}>
                    <input aria-label="Vastauksesi" placeholder="Vastauksesi" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                    <button type="submit" className="rounded-full bg-lime px-3 py-1 text-[13px] font-semibold text-lime-ink">OK</button>
                  </form>
                ) : (
                  <button type="button" className={chip(Boolean(own))} onClick={() => setClar({ ...clar, custom: i })}>{own ? clar.answers[i] : '+ Oma vastaus…'}</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="rounded-full bg-lime px-4 py-2 text-[14px] font-semibold text-lime-ink disabled:opacity-40" disabled={!Object.keys(clar.answers).length} onClick={onSend}>Kysy uudelleen</button>
        <span className="text-[12.5px] text-muted">tai kirjoita uusi kysymys yllä</span>
      </div>
    </article>
  );
}
