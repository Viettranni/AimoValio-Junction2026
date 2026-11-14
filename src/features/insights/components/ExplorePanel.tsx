'use client';

import { useState } from 'react';
import { STARTERS, type InsightsVM } from '../hooks/useInsights';
import { AnswerCard } from './AnswerCard';
import { ClarifyCard } from './ClarifyCard';
import { SiteSelect } from './SiteSelect';

const CATEGORIES = ['Dairy', 'Meat', 'Fish', 'Fruit & veg', 'Bakery', 'Dry goods', 'Plant-based'];
const EVENT_TYPES = ['Gala', 'Wedding', 'Conference', 'Christmas party', 'Birthday', 'Lunch'];
const PERIODS: Array<[string, string]> = [['last_month', 'This month'], ['last_3_months', 'Last 3 months'], ['last_6_months', 'Last 6 months']];

function Select({ label, options, value, onChange }: { label: string; options: Array<[string, string]>; value?: string; onChange: (v: string) => void }) {
  return (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/** Explore: page filters + a typed question -> chart, through the insight rails. */
export function ExplorePanel({ vm }: { vm: InsightsVM }) {
  const [text, setText] = useState('');
  const { answer, filters } = vm;
  return (
    <section aria-label="Explore" className="space-y-4">
      <form className="ik-card flex items-center gap-2 p-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void vm.ask(text.trim()); }}>
        <input className="min-w-0 flex-1 !border-0" aria-label="Your question" placeholder="Ask anything, e.g. waste by kitchen last 3 months"
          value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="rounded-full bg-lime px-5 py-2 text-[14px] font-semibold text-lime-ink">Ask</button>
      </form>
      <div className="flex flex-wrap gap-2">
        <SiteSelect sites={vm.sites} value={filters.siteId ?? ''} onChange={(v) => vm.setFilter('siteId', v)} />
        <Select label="Whole year" options={PERIODS} value={filters.period} onChange={(v) => vm.setFilter('period', v)} />
        <Select label="All categories" options={CATEGORIES.map((c) => [c, c])} value={filters.category} onChange={(v) => vm.setFilter('category', v)} />
        <Select label="All event types" options={EVENT_TYPES.map((c) => [c, c])} value={filters.event_type} onChange={(v) => vm.setFilter('event_type', v)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {STARTERS.map((s) => (
          <button key={s} type="button" onClick={() => { setText(''); void vm.ask(s); }}
            className={`rounded-full border px-3 py-1 text-[13px] ${vm.prompt === s ? 'border-navy bg-navy text-[var(--ik-surface)]' : 'border-line text-navy'}`}>{s}</button>
        ))}
      </div>
      {vm.loading ? <p role="status" className="text-[13.5px] text-muted">Asking your data…</p>
        : !answer ? null
          : 'error' in answer ? <div className="ik-card p-4 text-[13.5px] text-danger">{answer.error}</div>
            : 'clarify' in answer ? <ClarifyCard answer={answer} clar={vm.clar} setClar={vm.setClar} onSend={vm.sendClarify} />
              : <AnswerCard key={answer.sessionId} answer={answer} />}
    </section>
  );
}
