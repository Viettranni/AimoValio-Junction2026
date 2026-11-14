import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConnectClaude } from './ConnectClaude';
import { OpenAssistantButton } from './OpenAssistantButton';

export const metadata: Metadata = {
  title: 'Valio Aimo · Helsinki Juhlapalvelu Oy (prototyyppi)',
  description: 'Static, simplified Valio Aimo-style webshop page used to demo the Aimo Planner widget. Not the official site.',
};

const DISCLAIMER = 'Prototyyppi Junction 2026 -hackathoniin — ei Valio Aimon virallinen sivusto.';

const UTILITY_TABS = ['Valioaimo.fi', 'Pikatukku', 'Toimitustukku', 'VALO Tilauspalvelu', 'Minun Aimo'];
const NAV = ['Asiakkaaksi', 'Inspiroidu', 'Tuotteet', 'Reseptit', 'Ajankohtaista', 'Yritys', 'Analytiikka'];

// Mirrors the seeded demo history (src/ui/fixtures.ts); totals are excl. VAT.
const RECENT_ORDERS = [
  { id: 'VA-2026-03187', event: 'Häät', date: '8.8.2026', guests: 220, total: '565,58 €' },
  { id: 'VA-2026-02544', event: 'Juhannusjuhlat', date: '19.6.2026', guests: 280, total: '754,64 €' },
  { id: 'VA-2025-09902', event: 'Pikkujoulut', date: '12.12.2025', guests: 160, total: '629,49 €' },
];

const icon = (body: ReactNode, size = 22) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {body}
  </svg>
);

const QUICK_ORDER = [
  { title: 'Tuoreet', text: 'Hedelmät, vihannekset, liha ja kala', icon: icon(<><path d="M5 19C5 11 11 5 19 5c0 8-6 14-14 14z" /><path d="M5 19l8-8" /></>, 26) },
  { title: 'Pakasteet', text: 'Pakastetut raaka-aineet ja valmisruoat', icon: icon(<><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" /></>, 26) },
  { title: 'Kuivatuotteet', text: 'Riisit, jauhot, pastat ja mausteet', icon: icon(<><path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>, 26) },
  { title: 'Maitotuotteet', text: 'Maidot, kermat, juustot ja voi', icon: icon(<><path d="M9 3h6v3l2 3v12H7V9l2-3z" /><path d="M7 13h10" /></>, 26) },
];

const BOT = <img src="/aimo-bot.svg" alt="" width={28} height={28} className="shrink-0" />;

export default function DemoHostPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-ink">
      <p className="bg-lilac px-4 py-1.5 text-center text-[12px] leading-snug text-ink">{DISCLAIMER}</p>

      {/* Utility bar */}
      <div className="bg-navy text-white">
        <div className="mx-auto flex max-w-7xl items-stretch justify-between gap-4 px-4 text-[13px] md:px-6">
          <ul className="flex items-stretch">
            {UTILITY_TABS.map((tab, i) => (
              <li
                key={tab}
                className={
                  i === 0
                    ? 'flex items-center bg-white px-3 py-2 font-semibold text-navy'
                    : 'hidden items-center px-3 py-2 text-white/85 lg:flex'
                }
              >
                {tab}
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 items-center gap-3 py-1.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-lime text-[11px] font-bold text-lime-ink" aria-hidden="true">
              HJ
            </span>
            <span className="min-w-0 truncate">
              <span className="font-semibold">Helsinki Juhlapalvelu Oy</span>
              <span className="hidden text-white/80 sm:inline"> · Asiakasnro 100482</span>
            </span>
            <span className="border-l border-white/30 pl-3 font-semibold">FI</span>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-4 md:px-6">
          <span className="shrink-0 whitespace-nowrap font-display text-[26px] font-extrabold italic leading-none tracking-[-0.01em] text-navy sm:text-[30px] md:text-[34px]">
            Valio Aimo
          </span>
          <nav aria-label="Päävalikko" className="hidden xl:block">
            <ul className="flex gap-7 font-display text-[18px] font-bold uppercase tracking-[0.02em] text-navy">
              {NAV.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-1 sm:gap-2 md:gap-4">
            <span className="p-1.5 text-navy sm:p-2" aria-label="Haku" role="img">
              {icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>)}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-3 py-2 font-display text-[15px] sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[17px] font-bold uppercase tracking-[0.02em] text-lime-ink">
              {icon(<><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /><path d="M3 4h2l2.4 11h11l2-8H6.2" /></>, 20)}
              Ostoskori (0)
            </span>
            <span className="p-1.5 text-navy sm:p-2 xl:hidden" aria-label="Valikko" role="img">
              {icon(<path d="M4 7h16M4 12h16M4 17h16" />)}
            </span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section
        className="relative overflow-hidden text-white"
        style={{
          backgroundColor: '#005670',
          backgroundImage:
            'radial-gradient(rgba(255,255,255,0.07) 1.5px, transparent 1.5px), linear-gradient(135deg, #005670 0%, #003f52 100%)',
          backgroundSize: '22px 22px, 100% 100%',
        }}
      >
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 md:px-6 md:py-24 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="font-display text-[18px] font-bold uppercase tracking-[0.08em] text-lime">Minun Aimo</p>
            <h1 className="mt-3 font-display text-[46px] font-extrabold uppercase leading-[0.95] tracking-[-0.005em] sm:text-[64px] lg:text-[84px]">
              Hyvää päivää, Helsinki Juhlapalvelu
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-[1.6] text-white/90 md:text-[19px]">
              Kerro tilaisuudestasi — Aimo-avustaja kokoaa tilauksen puolestasi.
            </p>
            <OpenAssistantButton className="mt-8 inline-flex items-center gap-3 rounded-full bg-lime px-6 py-3.5 font-display text-[20px] font-bold uppercase tracking-[0.02em] text-lime-ink transition-colors hover:bg-lime-hover">
              {BOT}
              Avaa Aimo-avustaja
            </OpenAssistantButton>
          </div>

          <aside className="rounded-2xl bg-white p-6 text-ink shadow-card">
            <div className="flex items-center gap-3">
              <img src="/aimo-bot.svg" alt="" width={44} height={44} />
              <div>
                <p className="font-display text-[22px] font-extrabold uppercase leading-none text-navy">Aimo-avustaja</p>
                <p className="mt-1 text-[13px] text-muted">Tilaus yhdellä lauseella</p>
              </div>
            </div>
            <p className="mt-5 rounded-xl bg-ice px-4 py-3 text-[15px] leading-[1.55]">
              ”Meillä on häät 6.12., 300 vierasta, halutaan kanaa ja riisiä.”
            </p>
            <ul className="mt-4 space-y-2 text-[14px] text-ink-soft">
              <li>✓ Määrät menun ja vierasmäärän mukaan</li>
              <li>✓ Hinnat ja saatavuus toimituspäivälle</li>
              <li>✓ Allergiat ja aiemmat tilaukset huomioitu</li>
            </ul>
          </aside>
        </div>
      </section>

      {/* Recent orders */}
      <section className="bg-lilac">
        <div className="mx-auto max-w-7xl px-4 py-14 md:px-6 md:py-16">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-[36px] font-extrabold uppercase leading-none text-navy md:text-[44px]">Viimeisimmät tilaukset</h2>
            <span className="text-[15px] font-semibold text-navy underline underline-offset-4">Kaikki tilaukset</span>
          </div>
          <ul className="mt-8 space-y-3">
            {RECENT_ORDERS.map((order) => (
              <li key={order.id} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 rounded-xl bg-white px-5 py-4 md:grid-cols-[9rem_1fr_7rem_8rem_auto]">
                <span className="order-2 text-[14px] text-muted md:order-none md:text-[15px] md:text-ink">{order.date}</span>
                <span className="order-1 font-display text-[22px] font-bold uppercase leading-tight text-navy md:order-none">{order.event}</span>
                <span className="hidden text-[15px] text-ink-soft md:block">{order.guests} henkeä</span>
                <span className="hidden text-[13px] text-muted md:block">{order.id}</span>
                <span className="order-1 text-right text-[16px] font-semibold md:order-none">
                  {order.total}
                  <span className="block text-[12px] font-normal text-muted">alv 0 %</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Quick order */}
      <section className="bg-ice">
        <div className="mx-auto max-w-7xl px-4 py-14 md:px-6 md:py-16">
          <h2 className="font-display text-[36px] font-extrabold uppercase leading-none text-navy md:text-[44px]">Pikatilaus</h2>
          <ul className="mt-8 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            {QUICK_ORDER.map((tile) => (
              <li key={tile.title} className="rounded-xl border border-line bg-white p-5">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-sky text-navy">{tile.icon}</span>
                <p className="mt-4 font-display text-[24px] font-extrabold uppercase leading-none text-navy">{tile.title}</p>
                <p className="mt-2 text-[14px] leading-snug text-ink-soft">{tile.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Connect Claude over MCP */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-14 md:px-6 md:py-16 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="font-display text-[36px] font-extrabold uppercase leading-none text-navy md:text-[44px]">Aimo Claudessa</h2>
            <p className="mt-4 max-w-md text-[16px] leading-[1.6] text-ink-soft">
              Yhdistä oma tekoälyavustajasi Valio Aimoon: se suunnittelee tilaisuudet kalenterisi pohjalta, tilaa kiintein hinnoin valtuuksiesi
              rajoissa ja kirjaa hävikin.
            </p>
          </div>
          <ConnectClaude />
        </div>
      </section>

      <footer className="bg-navy text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 pr-24 md:flex-row md:items-center md:justify-between md:pl-6">
          <span className="font-display text-[28px] font-extrabold italic leading-none">Valio Aimo</span>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-white/85">
            <li>Asiakaspalvelu</li>
            <li>Toimitusehdot</li>
            <li>Tietosuoja</li>
            <li>Evästeasetukset</li>
          </ul>
        </div>
        <p className="border-t border-white/15 px-4 py-4 text-center text-[12px] text-white/80">{DISCLAIMER}</p>
      </footer>

      <script src="/widget.js" data-customer="helsinki-juhlapalvelu" defer />
    </div>
  );
}
