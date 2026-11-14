'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTheme, type Theme } from '../hooks/useTheme';
import '../insights-theme.css';

const LINKS = [
  { href: '/insights', label: 'Insights' },
  { href: '/restaurants', label: 'Restaurants' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/demo-host', label: 'Webshop' },
];

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <div role="group" aria-label="Theme" className="inline-flex rounded-full border border-line p-0.5 text-[12.5px]">
      {(['system', 'light', 'dark'] as const satisfies readonly Theme[]).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}
          className={`rounded-full px-3 py-1 capitalize ${theme === t ? 'bg-navy text-[var(--ik-surface)]' : 'text-muted'}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** Page frame for Insights and Restaurants: themed root, petrol header with the page title and navigation. */
export function InsightsShell({ title, eyebrow, active, children }: { title: string; eyebrow: string; active: string; children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className="ik-root min-h-screen" data-theme={theme}>
      <header className="border-b border-line bg-[var(--ik-surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{eyebrow}</p>
            <h1 className="font-display text-[34px] font-extrabold uppercase leading-none tracking-[0.01em] text-navy">{title}</h1>
          </div>
          <nav aria-label="Insights navigation" className="flex flex-wrap items-center gap-1 text-[14px]">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.href === active ? 'page' : undefined}
                className={`rounded-full px-3 py-1.5 font-semibold ${l.href === active ? 'bg-lime text-lime-ink' : 'text-navy hover:bg-sky'}`}>
                {l.label}
              </Link>
            ))}
            <span className="ml-2"><ThemeSwitch /></span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
