import type { KitchenSite } from '@/insights/views';
import { eur, initials, pct } from '../model/format';
import { Sparkline } from './Sparkline';

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'xl' }) {
  const cls = size === 'xl' ? 'h-14 w-14 text-[18px]' : size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-[12px]';
  return <span title={name} className={`grid shrink-0 place-items-center rounded-full bg-lime font-bold text-lime-ink ${cls}`}>{initials(name)}</span>;
}

/** One restaurant: last-30-day spend, left over and on-time, and a 12-month spend sparkline. */
export function SiteCard({ site, onOpen }: { site: KitchenSite; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="ik-card flex w-full flex-col gap-3 p-4 text-left transition-shadow hover:shadow-soft">
      <span className="flex items-center gap-3">
        <Avatar name={site.name.replace('Pohjola ', 'P ')} />
        <span><b className="block text-[15px] text-ink">{site.name}</b><small className="text-[12.5px] text-muted">{site.type}</small></span>
      </span>
      <span className="grid grid-cols-3 gap-2">
        {[[eur(site.spendMonth), 'last 30 days'], [pct({ v: site.wastePct, digits: 1 }), 'left over'],
          [site.onTimePct === null ? '–' : `${Math.round(site.onTimePct)}%`, 'on time']].map(([v, l]) => (
          <span key={l}><b className="block tabular-nums text-[16px] text-ink">{v}</b><small className="text-[12px] text-muted">{l}</small></span>
        ))}
      </span>
      <Sparkline values={site.trend} w={240} h={40} />
      <span className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
        <span>{site.address}</span><Avatar name={site.lead} size="sm" />
      </span>
    </button>
  );
}
