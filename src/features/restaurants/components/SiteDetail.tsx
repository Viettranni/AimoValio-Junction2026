'use client';

import Link from 'next/link';
import type { Kitchens, KitchenSite } from '@/insights/views';
import type { SiteTab } from '../hooks/useRestaurants';
import { eur, pct } from '../model/format';
import { Avatar } from './SiteCard';
import { Sparkline } from './Sparkline';

const TABS: Array<[SiteTab, string]> = [['overview', 'Yleiskatsaus'], ['people', 'Ihmiset'], ['deliveries', 'Toimitukset'], ['rules', 'Säännöt']];

/** The open kitchen's side panel: overview, people, deliveries, rules. */
export function SiteDetail({ site, data, tab, setTab, onClose }: {
  site: KitchenSite; data: Kitchens; tab: SiteTab; setTab: (t: SiteTab) => void; onClose: () => void;
}) {
  const people = [{ name: site.lead, role: 'Keittiövastaava' }, ...data.org.approvers.filter((a) => a.name !== site.lead)];
  return (
    <aside role="dialog" aria-label={site.name} className="fixed inset-y-0 right-0 z-20 w-full max-w-md overflow-y-auto border-l border-line bg-[var(--ik-surface)] p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-[20px] font-semibold text-ink">{site.name}</h2><p className="text-[13px] text-muted">{site.type}</p></div>
        <button type="button" onClick={onClose} className="rounded-full border border-line px-3 py-1 text-[13px] text-navy">Sulje</button>
      </div>
      <div role="tablist" className="mt-4 inline-flex rounded-full border border-line p-0.5 text-[13px]">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-full px-3 py-1 ${tab === k ? 'bg-navy text-[var(--ik-surface)]' : 'text-muted'}`}>{l}</button>
        ))}
      </div>
      <div className="mt-5 text-[13.5px]">
        {tab === 'overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              {[[eur(site.spendMonth), 'viim. 30 pv'], [String(site.ordersMonth), 'tilausta'], [pct({ v: site.wastePct, digits: 1 }), 'hävikki']].map(([v, l]) => (
                <div key={l}><b className="block font-display text-[26px] font-extrabold tabular-nums text-ink">{v}</b><small className="text-muted">{l}</small></div>
              ))}
            </div>
            <div><p className="mb-1 font-semibold text-ink-soft">Kulutus, viimeiset 12 kuukautta</p><Sparkline values={site.trend} w={360} h={80} /></div>
            <Link href={`/analytiikka/oivallukset?${new URLSearchParams({ buyerId: data.org.id, siteId: site.id })}`}
              className="inline-block rounded-full bg-lime px-4 py-2 font-semibold text-lime-ink">Katso analytiikka</Link>
          </div>
        )}
        {tab === 'people' && (
          <ul className="space-y-2">
            {people.map((p) => (
              <li key={p.name} className="flex items-center gap-3"><Avatar name={p.name} />
                <span><span className="block text-ink">{p.name}</span><small className="text-muted">{p.role}{data.org.approvers.some((a) => a.name === p.name) ? ' · voi hyväksyä tilauksia' : ''}</small></span></li>
            ))}
          </ul>
        )}
        {tab === 'deliveries' && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted">Osoite</dt><dd className="text-ink">{site.address}</dd>
            <dt className="text-muted">Toimituspäivät</dt>
            <dd className="flex flex-wrap gap-1">{site.deliveryDays.map((d) => <span key={d} className="rounded-full bg-sky px-2 py-0.5 text-[12px] text-ink">{d}</span>)}</dd>
            <dt className="text-muted">Aika</dt><dd className="text-ink">Aamulla</dd>
            <dt className="text-muted">Tilaa viimeistään</dt><dd className="text-ink">klo 17 edellisenä päivänä</dd>
          </dl>
        )}
        {tab === 'rules' && (
          <>
            <ul className="divide-y divide-line">{data.limits.map((l) => <li key={l.label} className="flex justify-between py-2"><span>{l.label}</span><b className="tabular-nums">{eur(l.value)}</b></li>)}</ul>
            <p className="mt-2 text-muted">Säännöt ovat yhteiset kaikille organisaation {data.org.name} ravintoloille.</p>
          </>
        )}
      </div>
    </aside>
  );
}
