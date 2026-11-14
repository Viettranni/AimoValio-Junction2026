'use client';

import { useInsights, type Tab } from '../hooks/useInsights';
import { ExplorePanel } from './ExplorePanel';
import { YearStory } from './YearStory';

const pill = (on: boolean) => `rounded-full px-3 py-1.5 ${on ? 'bg-navy text-[var(--ik-surface)]' : 'text-muted'}`;

export function InsightsPage({ initialBuyerId, initialSiteId }: { initialBuyerId?: string; initialSiteId?: string }) {
  const vm = useInsights({ initialBuyerId, initialSiteId });
  const live = vm.source === 'live';
  return (
    <>
      <h2 className="mb-4 font-display text-[28px] font-extrabold uppercase leading-none text-navy">Analytiikka</h2>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Tietolähde" className="inline-flex rounded-full border border-line p-0.5 text-[13px]">
          <button type="button" aria-pressed={!live} className={pill(!live)} onClick={() => vm.setSource('demo')}>Demohistoria</button>
          <button type="button" aria-pressed={live} className={pill(live)} onClick={() => vm.setSource('live')}>Oikeat tilaukset</button>
        </div>
        {!live && (
          <select aria-label="Organisaatio" value={vm.buyerId ?? ''} onChange={(e) => vm.setBuyer(e.target.value)}>
            {vm.directory?.demo.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div role="tablist" aria-label="Analytiikka" className="ml-auto inline-flex rounded-full border border-line p-0.5 text-[13px]">
          {(['year', 'explore'] as const satisfies readonly Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={vm.tab === t} className={pill(vm.tab === t)} onClick={() => vm.setTab(t)}>
              {t === 'year' ? 'Sinun vuotesi' : 'Tutki'}
            </button>
          ))}
        </div>
      </div>
      <p role="note" className={`mb-5 rounded-[10px] px-4 py-2.5 text-[13px] ${live ? 'bg-lime/20 text-ink' : 'bg-sky text-ink-soft'}`}>
        {live
          ? <><b>Oikeat tilaukset:</b> {vm.buyer ? `asiakkaan ${vm.buyer.name} tässä sovelluksessa tekemät tilaukset` : 'tässä sovelluksessa ei ole vielä asiakkaita'}. Ravintola-, ajallaan-, CO₂- ja hävikkiluvut näkyvät vain, kun tilauksella on ne.</>
          : <><b>Demotila:</b> generoitu vuosi tilaushistoriaa (joulu 2025 – marras 2026) organisaatiolle {vm.buyer?.name ?? 'demoorganisaatiot'}.</>}
      </p>
      {vm.tab === 'year' ? <YearStory vm={vm} /> : <ExplorePanel vm={vm} />}
    </>
  );
}
