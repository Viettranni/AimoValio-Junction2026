'use client';

import { InsightsShell } from '@/shared/components/InsightsShell';
import { useInsights, type Tab } from '../hooks/useInsights';
import { ExplorePanel } from './ExplorePanel';
import { YearStory } from './YearStory';

const pill = (on: boolean) => `rounded-full px-3 py-1.5 ${on ? 'bg-navy text-[var(--ik-surface)]' : 'text-muted'}`;

export function InsightsPage({ initialBuyerId, initialSiteId }: { initialBuyerId?: string; initialSiteId?: string }) {
  const vm = useInsights({ initialBuyerId, initialSiteId });
  const live = vm.source === 'live';
  return (
    <InsightsShell title="Insights" eyebrow="Valio Aimo · Your restaurants" active="/insights">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Data" className="inline-flex rounded-full border border-line p-0.5 text-[13px]">
          <button type="button" aria-pressed={!live} className={pill(!live)} onClick={() => vm.setSource('demo')}>Demo history</button>
          <button type="button" aria-pressed={live} className={pill(live)} onClick={() => vm.setSource('live')}>Live orders</button>
        </div>
        {!live && (
          <select aria-label="Organisation" value={vm.buyerId ?? ''} onChange={(e) => vm.setBuyer(e.target.value)}>
            {vm.directory?.demo.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div role="tablist" aria-label="Insights" className="ml-auto inline-flex rounded-full border border-line p-0.5 text-[13px]">
          {(['year', 'explore'] as const satisfies readonly Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={vm.tab === t} className={pill(vm.tab === t)} onClick={() => vm.setTab(t)}>
              {t === 'year' ? 'Your year' : 'Explore'}
            </button>
          ))}
        </div>
      </div>
      <p role="note" className={`mb-5 rounded-[10px] px-4 py-2.5 text-[13px] ${live ? 'bg-lime/20 text-ink' : 'bg-sky text-ink-soft'}`}>
        {live
          ? <><b>Live mode:</b> {vm.buyer ? `${vm.buyer.name}'s orders placed in this app` : 'no customers in this app yet'}. Restaurant, on-time, CO₂ and leftover figures appear only where the order has them.</>
          : <><b>Demo mode:</b> a generated year of order history (Dec 2025 – Nov 2026) for {vm.buyer?.name ?? 'the demo organisations'}.</>}
      </p>
      {vm.tab === 'year' ? <YearStory vm={vm} /> : <ExplorePanel vm={vm} />}
    </InsightsShell>
  );
}
