'use client';

import { useEffect } from 'react';
import { VegaChart } from '@/shared/components/VegaChart';
import type { InsightsVM } from '../hooks/useInsights';
import { SiteSelect } from './SiteSelect';

/** "Your year": a Wrapped-style story, one card at a time (arrow keys and swipe-free buttons). */
export function YearStory({ vm }: { vm: InsightsVM }) {
  const { wrapped, card, step, setTab } = vm;
  const cards = wrapped?.cards ?? [];
  const c = cards[Math.min(card, cards.length - 1)];
  const last = card >= cards.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  return (
    <section aria-label="Your year">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SiteSelect sites={vm.sites} value={vm.yearSite} onChange={vm.setYearSite} />
        <span className="text-[13px] text-muted">{wrapped?.title}</span>
      </div>
      {!wrapped ? <p className="text-[13.5px] text-muted">Loading your year…</p> : !c ? <p className="text-[13.5px] text-muted">Nothing to show.</p> : (
        <>
          <article className="ik-card relative overflow-hidden p-6 md:p-8" aria-roledescription="story" aria-label={`Card ${card + 1} of ${cards.length}`}>
            <div className="mb-6 flex gap-1" aria-hidden="true">
              {cards.map((_, i) => <i key={i} className={`h-1 flex-1 rounded-full ${i <= card ? 'bg-navy' : 'bg-line'}`} />)}
            </div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{c.eyebrow}</p>
            <h2 className="mt-2 font-display text-[40px] font-extrabold uppercase leading-[0.95] text-navy md:text-[54px]">{c.headline}</h2>
            {c.sub && <p className={`mt-3 max-w-2xl text-[16px] ${c.tone === 'watch' ? 'text-warn' : 'text-ink-soft'}`}>{c.sub}</p>}
            {c.numbers.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-8">
                {c.numbers.map((n) => (
                  <div key={n.label}><b className="block font-display text-[34px] font-extrabold tabular-nums text-ink">{n.value}</b>
                    <span className="text-[13px] text-muted">{n.label}</span></div>
                ))}
              </div>
            )}
            {c.chart && <div className="mt-6"><VegaChart spec={c.chart} height={170} /></div>}
          </article>
          <div className="mt-3 flex items-center justify-between">
            <button type="button" className="rounded-full border border-line px-4 py-2 text-[14px] text-navy disabled:opacity-40" disabled={card === 0} onClick={() => step(-1)}>Previous</button>
            <span className="text-[13px] tabular-nums text-muted">{card + 1} / {cards.length}</span>
            {last
              ? <button type="button" className="rounded-full bg-lime px-4 py-2 text-[14px] font-semibold text-lime-ink" onClick={() => setTab('explore')}>Explore your data</button>
              : <button type="button" className="rounded-full border border-line px-4 py-2 text-[14px] text-navy" onClick={() => step(1)}>Next</button>}
          </div>
        </>
      )}
    </section>
  );
}
