'use client';

import { useRestaurants } from '../hooks/useRestaurants';
import { eur } from '../model/format';
import { Avatar, SiteCard } from './SiteCard';
import { SiteDetail } from './SiteDetail';

/** Restaurants: a CRM-style view of every site in the organisation, with a detail panel per site. */
export function RestaurantsPage() {
  const vm = useRestaurants();
  const d = vm.data;
  return (
    <>
      <h2 className="mb-4 font-display text-[28px] font-extrabold uppercase leading-none text-navy">Ravintolat</h2>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Organisaatio">
        {vm.orgs.map((o) => (
          <button key={o.id} type="button" aria-pressed={o.id === vm.buyerId} onClick={() => vm.pickOrg(o.id)}
            className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[13.5px] ${o.id === vm.buyerId ? 'border-navy bg-sky text-ink' : 'border-line text-ink-soft'}`}>
            <Avatar name={o.name} size="sm" />{o.name}
          </button>
        ))}
      </div>
      <p role="note" className="mb-5 rounded-[10px] bg-sky px-4 py-2.5 text-[13px] text-ink-soft">
        <b>Demotila:</b> ravintolat, ihmiset ja luvut tulevat demoorganisaatioista ja niiden generoidusta tilausvuodesta.
      </p>
      {vm.error && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">Ravintoloita ei voitu ladata ({vm.error}).</p>}
      {!d ? <p className="text-[13.5px] text-muted">Ladataan…</p> : (
        <div className="space-y-6">
          <section className="ik-card flex flex-wrap items-center justify-between gap-6 p-5">
            <div className="flex items-center gap-4"><Avatar name={d.org.name} size="xl" />
              <div><h2 className="text-[22px] font-semibold text-ink">{d.org.name}</h2><p className="text-[13.5px] text-muted">{d.org.segment} · {d.sites.length} {d.sites.length === 1 ? 'ravintola' : 'ravintolaa'}</p></div></div>
            <div className="flex flex-wrap gap-8 text-[13.5px]">
              <div className="min-w-48"><small className="block text-muted">Luottoa käytössä</small>
                <b className="tabular-nums text-ink">{eur(d.org.openInvoices)} <span className="font-normal text-muted">/ {eur(d.org.creditLimit)}</span></b>
                <span className="mt-1 block h-1.5 rounded-full bg-line"><i className="block h-1.5 rounded-full bg-navy" style={{ width: `${Math.min(100, (d.org.openInvoices / d.org.creditLimit) * 100).toFixed(0)}%` }} /></span></div>
              <div><small className="block text-muted">Tilausten hyväksyjät</small><span className="mt-1 flex gap-1">{d.org.approvers.map((a) => <Avatar key={a.id} name={a.name} />)}</span></div>
              <div><small className="block text-muted">Hinnat</small><b className="text-ink">{d.liveApi ? 'Livenä Valio Aimolta' : 'Demohinnat'}</b></div>
            </div>
          </section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d.sites.map((s) => <SiteCard key={s.id} site={s} onOpen={() => vm.open(s.id)} />)}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <section className="ik-card p-5"><h2 className="mb-2 font-display text-[20px] font-bold uppercase text-navy">Suosikit, kaikki ravintolat</h2>
              <ul className="divide-y divide-line text-[13.5px]">
                {d.favourites.length ? d.favourites.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-2 py-2"><span className="text-ink">★ {f.name}</span>{f.pinned && <small className="rounded-full bg-lime/30 px-2 text-[11.5px] text-ink">Aina ensin</small>}</li>
                )) : <li className="py-2 text-muted">Ei vielä. Muistan, mitä valitset.</li>}
              </ul></section>
            <section className="ik-card p-5"><h2 className="mb-2 font-display text-[20px] font-bold uppercase text-navy">Säännöt</h2>
              <ul className="divide-y divide-line text-[13.5px]">
                {d.limits.map((l) => <li key={l.label} className="flex justify-between py-2"><span>{l.label}</span><b className="tabular-nums">{eur(l.value)}</b></li>)}
                <li className="py-2">Älä koskaan tilaa<small className="block text-muted">{d.allergens.length ? d.allergens.join(', ') : 'Mitään ei ole estetty'}</small></li>
              </ul></section>
          </div>
          <section className="ik-card p-5"><h2 className="mb-2 font-display text-[20px] font-bold uppercase text-navy">Näin se toimii</h2>
            <p className="text-[13.5px] text-ink-soft">Jokainen avustaja, meidän tai kenen tahansa, noudattaa samoja yhdyskäytävän tarkistamia vaiheita: ymmärrä, muista suosikkisi ensin, etsi lisää vain puutteisiin, suunnittele, tarkista säännöt, näytä kortit, tilaa, opi. Datasi kysymykset noudattavat toista vaihejoukkoa: kuvaa, kysy, valitse kaavio, selitä.</p></section>
        </div>
      )}
      {d && vm.site && <SiteDetail site={vm.site} data={d} tab={vm.siteTab} setTab={vm.setSiteTab} onClose={() => vm.open(null)} />}
    </>
  );
}
