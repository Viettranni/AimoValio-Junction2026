'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const TABS = [
  { href: '/products', label: 'Products' },
  { href: '/orders', label: 'Orders' },
  { href: '/restaurants', label: 'Restaurants' },
];

/** Everything that used to have its own header, one click away from the profile menu. */
const MORE = [
  { href: '/analytiikka/oivallukset', label: 'Analytics (classic)' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/demo-host', label: 'Webshop demo (widget)' },
];

/** The Aimo app frame: logo, the three sections, and the account menu. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="aimo-app flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex-none border-b border-line bg-white">
        <div className="mx-auto grid h-16 max-w-[1400px] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 md:px-6">
          <Link href="/orders" aria-label="Valio Aimo, home" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG; next/image adds nothing here. */}
            <img src="/valio-aimo-logo.svg" alt="Valio Aimo" width={102} height={34} className="h-[30px] w-auto md:h-[34px]" />
          </Link>
          <nav aria-label="Main" className="flex justify-center gap-5 sm:gap-10 md:gap-16">
            {TABS.map((tab) => {
              const on = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={on ? 'page' : undefined}
                  className={`relative flex h-16 items-center text-[14px] font-semibold transition-colors sm:text-[15px] ${
                    on ? 'text-navy' : 'text-muted hover:text-navy'
                  }`}
                >
                  {tab.label}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 bottom-2.5 h-[3px] rounded-full bg-navy transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`}
                  />
                </Link>
              );
            })}
          </nav>
          <AccountMenu />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-full text-navy transition-colors hover:bg-sky"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="10" r="3.4" />
          <path d="M5.6 18.6c1.4-2.3 3.7-3.6 6.4-3.6s5 1.3 6.4 3.6" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-64 rounded-xl border border-line bg-white p-1.5 shadow-card">
          <div className="px-3 pb-2 pt-2">
            <div className="text-[13.5px] font-semibold text-ink">Helsinki Juhlapalvelu Oy</div>
            <div className="text-[12px] text-muted">Customer no. 100482</div>
          </div>
          <div className="my-1 h-px bg-line" />
          {MORE.map((l) => (
            <Link key={l.href} role="menuitem" href={l.href} className="block rounded-lg px-3 py-2 text-[13.5px] text-navy hover:bg-sky">
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
