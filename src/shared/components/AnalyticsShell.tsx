'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import '../analytics.css';

const SECTIONS = [
  { href: '/analytiikka/oivallukset', label: 'Analytiikka' },
  { href: '/analytiikka/ravintolat', label: 'Ravintolat' },
  { href: '/approvals', label: 'Hyväksynnät' },
];

const OTHER = [
  { href: '/demo-host', label: '← Verkkokauppa' },
];

/** Page frame for Analytiikka: petrol title, links back to the rest of the app, and the section menu. */
export function AnalyticsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="ik-root min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-3 px-4 py-5">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-lime">Valio Aimo</p>
            <h1 className="font-display text-[34px] font-extrabold uppercase leading-none tracking-[0.01em]">Analytiikka</h1>
          </div>
          <nav aria-label="Sovellus" className="flex gap-4 text-[13.5px] text-white/85">
            {OTHER.map((l) => <Link key={l.href} href={l.href} className="underline-offset-4 hover:underline">{l.label}</Link>)}
          </nav>
        </div>
      </header>
      <div className="border-b border-line bg-[var(--ik-surface)]">
        <nav aria-label="Analytiikka" className="mx-auto flex max-w-6xl gap-1 px-4 py-2 text-[14px]">
          {SECTIONS.map((s) => {
            const on = pathname.startsWith(s.href);
            return (
              <Link key={s.href} href={s.href} aria-current={on ? 'page' : undefined}
                className={`rounded-full px-4 py-1.5 font-semibold ${on ? 'bg-lime text-lime-ink' : 'text-navy hover:bg-sky'}`}>{s.label}</Link>
            );
          })}
        </nav>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
