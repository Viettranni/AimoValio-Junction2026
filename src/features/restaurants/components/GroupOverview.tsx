'use client';

import '@/shared/analytics.css';
import { useState } from 'react';
import { ExplorePanel } from '@/features/insights/components/ExplorePanel';
import { YearStory } from '@/features/insights/components/YearStory';
import { useInsights } from '@/features/insights/hooks/useInsights';
import type { KitchenSite, Kitchens } from '@/insights/views';
import { useRestaurants } from '../hooks/useRestaurants';
import { Avatar } from './SiteCard';
import { SiteDetail } from './SiteDetail';

const money = (v: number | null | undefined) =>
  v === null || v === undefined ? '–' : v.toLocaleString('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const percent = (v: number | null) => (v === null ? '–' : `${v.toFixed(1)}%`);

/** The server labels the mandate limits in Finnish; the app shows them in English. */
const LIMIT_LABEL: Record<string, string> = { 'Tilausta kohti': 'Per order', 'Tapahtumaa kohti': 'Per event', Kuukaudessa: 'Per month' };

type Section = 'overview' | 'year' | 'explore';
const SECTIONS: Array<[Section, string]> = [['overview', 'Overview'], ['year', 'Your year'], ['explore', 'Explore']];

/**
 * Restaurants = the analytics home: the group's sites at a glance (spending, waste, share of the biggest site),
 * then the organisation overview, the "Your year" story and Explore (ask your order data anything).
 */
export function GroupOverview() {
  const vm = useRestaurants();
  const insights = useInsights({ initialBuyerId: vm.buyerId });
  const [section, setSection] = useState<Section>('overview');
  const d = vm.data;
  const maxSpend = d ? Math.max(1, ...d.sites.map((s) => s.spendMonth)) : 1;

  const pickOrg = (id: string) => {
    vm.pickOrg(id);
    insights.setBuyer(id);
  };
  const openSection = (s: Section) => {
    setSection(s);
    if (s !== 'overview') insights.setTab(s);
  };

  return (
    <main className="ik-root mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-navy">{d?.org.name ?? ' '}</h1>
        <div className="flex items-center gap-4">
          {vm.orgs.length > 1 && (
            <select aria-label="Switch organisation" value={vm.buyerId} onChange={(e) => pickOrg(e.target.value)} className="!py-1 !text-[13px]">
              {vm.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <span className="text-[14px] text-muted">Last 30 days</span>
        </div>
      </div>

      {vm.error && <p className="mt-6 rounded-xl bg-white px-5 py-4 text-[14px] text-danger shadow-soft">Restaurants could not be loaded ({vm.error}).</p>}

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy={!d}>
        {!d && !vm.error &&
          Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="h-[184px] rounded-2xl bg-white p-6 shadow-soft">
              <div className="aimo-shimmer h-5 w-1/2 rounded" />
              <div className="aimo-shimmer mt-8 h-8 w-2/3 rounded" />
              <div className="aimo-shimmer mt-8 h-1 w-full rounded" />
            </li>
          ))}
        {d?.sites.map((site) => (
          <li key={site.id}>
            <SiteTile site={site} share={site.spendMonth / maxSpend} onOpen={() => vm.open(site.id)} />
          </li>
        ))}
      </ul>

      <div role="tablist" aria-label="Analytics" className="mt-10 flex gap-8 border-b border-line">
        {SECTIONS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            onClick={() => openSection(key)}
            className={`relative -mb-px pb-3 text-[15px] font-semibold transition-colors ${section === key ? 'text-navy' : 'text-muted hover:text-navy'}`}
          >
            {label}
            <span aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-navy ${section === key ? '' : 'opacity-0'}`} />
          </button>
        ))}
      </div>

      <div className="mt-6">
        {section === 'overview' ? (
          d ? <OrgOverview data={d} /> : null
        ) : (
          <>
            <DataSource vm={insights} />
            {section === 'year' ? <YearStory vm={insights} /> : <ExplorePanel vm={insights} />}
          </>
        )}
      </div>

      {d && vm.site && (
        <>
          <button type="button" aria-label="Close" onClick={() => vm.open(null)} className="fixed inset-0 z-30 cursor-default bg-ink/20" />
          <SiteDetail
            site={vm.site}
            data={d}
            tab={vm.siteTab}
            setTab={vm.setSiteTab}
            onClose={() => vm.open(null)}
            onAnalytics={() => {
              const id = vm.site!.id;
              vm.open(null);
              setSection('explore');
              insights.setTab('explore');
              insights.setFilter('siteId', id);
            }}
          />
        </>
      )}
    </main>
  );
}

function SiteTile({ site, share, onOpen }: { site: KitchenSite; share: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col rounded-2xl bg-white p-6 text-left shadow-soft transition-shadow hover:shadow-card"
    >
      <span className="text-[18px] font-bold text-navy">{site.name}</span>
      <span className="mt-6 grid grid-cols-[1.5fr_1fr] gap-4">
        <span>
          <b className="block text-[30px] font-bold leading-none tracking-[-0.01em] tabular-nums text-navy">{money(site.spendMonth)}</b>
          <small className="mt-2 block text-[14px] text-muted">Spending</small>
        </span>
        <span>
          <b className="block pt-1.5 text-[22px] font-bold leading-none tabular-nums text-navy">{percent(site.wastePct)}</b>
          <small className="mt-2.5 block text-[14px] text-muted">Waste</small>
        </span>
      </span>
      <span className="mt-6 block h-[3px] w-full overflow-hidden rounded-full bg-sky" aria-hidden="true">
        <span className="block h-full rounded-full bg-app-teal-bar" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </button>
  );
}

/** Demo history or the orders placed in this app; the explanation says which one the numbers come from. */
function DataSource({ vm }: { vm: ReturnType<typeof useInsights> }) {
  const live = vm.source === 'live';
  const seg = (on: boolean) => `rounded-full px-4 py-1.5 transition-colors ${on ? 'bg-navy text-white' : 'text-muted hover:text-navy'}`;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Data source" className="inline-flex rounded-full bg-white p-1 text-[13.5px] font-medium shadow-soft">
        <button type="button" aria-pressed={!live} className={seg(!live)} onClick={() => vm.setSource('demo')}>Demo history</button>
        <button type="button" aria-pressed={live} className={seg(live)} onClick={() => vm.setSource('live')}>Real orders</button>
      </div>
      <p className="text-[13px] text-muted">
        {live
          ? vm.buyer
            ? `Orders ${vm.buyer.name} placed in this app. Site, on-time, CO₂ and waste figures appear once an order has them.`
            : 'No customer has ordered in this app yet.'
          : `A generated year of order history (Dec 2025 – Nov 2026) for ${vm.buyer?.name ?? 'the demo organisations'}.`}
      </p>
    </div>
  );
}

function OrgOverview({ data: d }: { data: Kitchens }) {
  const used = Math.min(100, (d.org.openInvoices / d.org.creditLimit) * 100);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-2xl bg-white p-6 shadow-soft lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <Avatar name={d.org.name} size="xl" />
            <div>
              <h2 className="text-[18px] font-bold text-navy">{d.org.name}</h2>
              <p className="text-[14px] text-muted">
                {d.org.segment} · {d.sites.length} {d.sites.length === 1 ? 'restaurant' : 'restaurants'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-10 text-[14px]">
            <div className="min-w-52">
              <small className="block text-[13px] text-muted">Credit in use</small>
              <b className="tabular-nums text-ink">
                {money(d.org.openInvoices)} <span className="font-normal text-muted">/ {money(d.org.creditLimit)}</span>
              </b>
              <span className="mt-1.5 block h-[3px] rounded-full bg-sky">
                <i className="block h-[3px] rounded-full bg-navy" style={{ width: `${used.toFixed(0)}%` }} />
              </span>
            </div>
            <div>
              <small className="block text-[13px] text-muted">Order approvers</small>
              <span className="mt-1 flex gap-1">{d.org.approvers.map((a) => <Avatar key={a.id} name={a.name} />)}</span>
            </div>
            <div>
              <small className="block text-[13px] text-muted">Prices</small>
              <b className="text-ink">{d.liveApi ? 'Live from Valio Aimo' : 'Demo prices'}</b>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-soft">
        <h2 className="mb-2 text-[16px] font-bold text-navy">Favourites, all restaurants</h2>
        <ul className="divide-y divide-line text-[14px]">
          {d.favourites.length ? (
            d.favourites.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-2 py-2.5">
                <span className="text-ink">★ {f.name}</span>
                {f.pinned && <small className="flex-none whitespace-nowrap rounded-full bg-sky px-2.5 py-0.5 text-[12px] font-medium text-navy">Always first</small>}
              </li>
            ))
          ) : (
            <li className="py-2.5 text-muted">None yet. Aimo remembers what you pick.</li>
          )}
        </ul>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-soft">
        <h2 className="mb-2 text-[16px] font-bold text-navy">Rules</h2>
        <ul className="divide-y divide-line text-[14px]">
          {d.limits.map((l) => (
            <li key={l.label} className="flex justify-between py-2.5">
              <span className="text-ink-soft">{LIMIT_LABEL[l.label] ?? l.label}</span>
              <b className="tabular-nums text-ink">{money(l.value)}</b>
            </li>
          ))}
          <li className="py-2.5">
            <span className="text-ink-soft">Never order</span>
            <small className="block text-[13px] text-muted">{d.allergens.length ? d.allergens.join(', ') : 'Nothing is blocked'}</small>
          </li>
        </ul>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-soft">
        <h2 className="mb-2 text-[16px] font-bold text-navy">How it works</h2>
        <p className="text-[14px] leading-relaxed text-ink-soft">
          Every assistant, ours or anyone&apos;s, follows the same gateway-checked steps: understand, remember your favourites first, search only
          for what is missing, plan, check the rules, show the cards, order, learn. Questions about your data follow their own steps: describe,
          ask, pick a chart, explain.
        </p>
      </section>
    </div>
  );
}
