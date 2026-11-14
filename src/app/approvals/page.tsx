import type { Metadata } from 'next';
import { ApprovalsBoard } from './ApprovalsBoard';

export const metadata: Metadata = {
  title: 'Approvals · Aimo',
  description: 'Sign off purchasing-agent orders that are outside their authority.',
};

export default function ApprovalsPage() {
  return (
    <main className="min-h-screen bg-ice text-ink">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-5xl items-end justify-between gap-4 px-4 py-5">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-lime">Valio Aimo · Agent gateway</p>
            <h1 className="font-display text-[34px] font-extrabold uppercase leading-none tracking-[0.01em]">Approvals</h1>
          </div>
          <p className="hidden max-w-sm text-right text-[12.5px] leading-[18px] text-white/80 sm:block">
            Orders from purchasing agents that are outside their authority wait here. Approving re-checks live Valio prices and stock first.
          </p>
        </div>
      </header>
      <ApprovalsBoard />
    </main>
  );
}
