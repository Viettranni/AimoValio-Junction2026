'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Receipt } from '@/contracts';
import type { Approval, Change, Offer } from '@/gateway/types';

type Row = { approval: Approval; offer: Offer | null; customerName: string };
type Outcome =
  | { status: 'ordered'; receipt: Receipt }
  | { status: 'rejected' }
  | { status: 'requote'; newOffer: Offer; changes: Change[] }
  | { status: 'error'; message: string };

const eur = (n: number) => `€${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PRIMARY = 'rounded-xl bg-navy px-6 py-2.5 text-[14px] font-bold text-white transition-[background-color,opacity] hover:bg-blue-hover disabled:opacity-40';
const SECONDARY = 'rounded-xl border border-line bg-white px-6 py-2.5 text-[14px] font-bold transition-[background-color,opacity] hover:bg-sky disabled:opacity-40';
const FIELD = 'mt-1 rounded-xl border border-transparent bg-ice px-3 py-2 text-[14px] font-normal text-ink outline-none focus:border-blue';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' });

export function ApprovalsBoard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals?status=all', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows(await res.json());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Poll so a request from a terminal agent shows up without a reload.
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 4000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [load]);

  const pending = rows?.filter((r) => r.approval.status === 'pending') ?? [];
  const decided = rows?.filter((r) => r.approval.status !== 'pending') ?? [];

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-navy">Approvals</h1>
        <p className="max-w-md text-[14px] text-muted sm:text-right">
          Orders from purchasing agents that are outside their authority wait here. Approving re-checks live Valio prices and stock first.
        </p>
      </div>
      {loadError && <p className="mt-6 rounded-2xl bg-white px-6 py-4 text-[14px] text-danger shadow-soft">Could not load approvals ({loadError}).</p>}
      <h2 className="mt-8 text-[17px] font-bold text-navy">
        Waiting for you <span className="ml-1 rounded-full bg-sky px-2.5 py-0.5 text-[13px] tabular-nums">{pending.length}</span>
      </h2>
      {rows === null ? (
        <div className="mt-4 h-[120px] rounded-2xl bg-white p-6 shadow-soft" aria-busy="true">
          <div className="aimo-shimmer h-5 w-1/3 rounded" />
          <div className="aimo-shimmer mt-4 h-4 w-1/2 rounded" />
        </div>
      ) : pending.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white p-6 text-[14.5px] text-muted shadow-soft">
          Nothing to approve. Orders within an agent&apos;s authority go straight through.
        </p>
      ) : (
        <div className="mt-4 space-y-5">{pending.map((r) => <ApprovalCard key={r.approval.approvalId} row={r} onDone={load} />)}</div>
      )}
      {decided.length > 0 && (
        <>
          <h2 className="mt-10 text-[17px] font-bold text-navy">Decided</h2>
          <ul className="mt-4 divide-y divide-line rounded-2xl bg-white px-6 shadow-soft">
            {decided.map(({ approval: a, offer }) => (
              <li key={a.approvalId} className="grid gap-x-6 gap-y-1 py-4 text-[14px] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-baseline">
                <span className="font-semibold text-ink">{a.agentName} <span className="font-normal text-muted">· {a.approvalId}</span></span>
                <span className="text-muted">
                  {offer && <b className="font-bold tabular-nums text-navy">{eur(offer.totals.total)}</b>}
                  {offer ? ' excl. VAT · ' : ''}{a.decidedAt ? when(a.decidedAt) : ''}
                </span>
                <span className={`md:text-right ${a.status === 'approved' ? 'font-medium text-app-teal' : a.status === 'rejected' ? 'font-medium text-danger' : 'font-medium text-app-amber'}`}>
                  {a.status === 'approved' ? `Approved → ${a.orderId}` : a.status === 'rejected' ? 'Rejected' : `Re-quoted → ${a.newOfferId}`}
                  {a.decidedBy ? ` by ${a.decidedBy}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function ApprovalCard({ row, onDone }: { row: Row; onDone: () => void }) {
  const { approval: a, offer, customerName } = row;
  const [name, setName] = useState(a.approver.name);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision);
    try {
      const res = await fetch(`/api/approvals/${a.approvalId}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, approverName: name, ...(note.trim() ? { note } : {}) }),
      });
      const body = await res.json();
      setOutcome(res.ok ? body : { status: 'error', message: body.error ?? `HTTP ${res.status}` });
    } catch (e) {
      setOutcome({ status: 'error', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="rounded-2xl bg-white p-6 shadow-soft md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <h3 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-navy">{a.agentName}</h3>
          <p className="mt-1 text-[15px] text-muted">
            for {customerName} · requested {when(a.createdAt)}
            {offer && <> · delivery {offer.deliveryDate}{offer.cutoff && <> · order by {when(offer.cutoff)}</>}</>}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">{a.approvalId} · offer {a.offerId}</p>
        </div>
        {offer && (
          <div className="sm:text-right">
            <p className="text-[24px] font-bold leading-tight tracking-[-0.01em] tabular-nums text-navy">{eur(offer.totals.total)} excl. VAT</p>
            <p className="text-[13px] text-muted tabular-nums">{eur(offer.totals.totalWithTax)} incl. VAT</p>
          </div>
        )}
      </div>

      <div className="pt-5">
        <p className="text-[14px] font-semibold text-app-amber">Why it needs you</p>
        <ul className="mt-1.5 space-y-1">
          {a.reasons.map((r) => (
            <li key={r.rule} className="text-[14.5px] text-ink-soft">{r.message}</li>
          ))}
        </ul>

        {offer && (
          <table className="mt-5 w-full text-[15px]">
            <thead>
              <tr className="text-left text-[13px] text-muted">
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 text-right font-medium">Packs</th>
                <th className="hidden pb-2 text-right font-medium sm:table-cell">Per pack</th>
                <th className="pb-2 text-right font-medium">Line</th>
              </tr>
            </thead>
            <tbody>
              {offer.lines.map((l) => (
                <tr key={l.lineId} className={`border-t border-line ${l.available ? '' : 'text-muted'}`}>
                  <td className="py-3 pr-3">
                    <span className={`font-medium ${l.available ? 'text-ink' : 'text-muted'}`}>{l.productName}</span>
                    <span className={`block text-[13px] ${l.available ? 'text-muted' : 'text-danger'}`}>
                      {l.packDescription}{l.available ? '' : ` · not ordered: ${l.reason ?? l.status}`}
                    </span>
                  </td>
                  <td className="py-3 text-right font-bold tabular-nums text-ink">{l.packs}</td>
                  <td className="hidden py-3 pl-3 text-right tabular-nums text-ink-soft sm:table-cell">{l.unitPrice === null ? '—' : eur(l.unitPrice)}</td>
                  <td className="py-3 pl-3 text-right font-bold tabular-nums text-navy">{l.available ? eur(l.lineTotal) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-2 border-t border-line pt-5">
        {outcome ? (
          <OutcomeView outcome={outcome} onDone={onDone} />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-[13px] font-medium text-muted">
              Approver
              <input value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} w-52`} />
            </label>
            <label className="flex min-w-48 flex-1 flex-col text-[13px] font-medium text-muted">
              Note (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. OK for the gala" className={FIELD} />
            </label>
            <button disabled={!!busy || !name.trim()} onClick={() => decide('reject')} className={`${SECONDARY} text-danger`}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
            <button disabled={!!busy || !name.trim()} onClick={() => decide('approve')} className={PRIMARY}>
              {busy === 'approve' ? 'Checking Valio…' : 'Approve'}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function OutcomeView({ outcome, onDone }: { outcome: Outcome; onDone: () => void }) {
  const done = <button onClick={onDone} className="ml-auto text-[13.5px] font-semibold text-navy underline underline-offset-4">Refresh list</button>;
  if (outcome.status === 'ordered') {
    const r = outcome.receipt;
    return (
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className="font-semibold text-app-teal">Ordered {r.orderId}</span>
        <span className="text-ink-soft">· {r.lines.length} line(s) · {eur(r.total)} excl. VAT · delivery {r.deliveryDate} · simulated order, nothing is charged</span>
        {done}
      </div>
    );
  }
  if (outcome.status === 'requote') {
    return (
      <div className="text-[14px]">
        <p className="font-semibold text-app-amber">Prices or stock changed, so nothing was ordered. New offer {outcome.newOffer.offerId} ({eur(outcome.newOffer.totals.total)}) went back to the agent.</p>
        <ul className="mt-1 list-disc pl-5 text-ink-soft">{outcome.changes.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
        <div className="mt-1 flex">{done}</div>
      </div>
    );
  }
  if (outcome.status === 'rejected') return <div className="flex text-[14px]"><span className="font-semibold text-danger">Rejected. The agent sees this in getOrderStatus.</span>{done}</div>;
  return <div className="flex text-[14px]"><span className="font-semibold text-danger">{outcome.message}</span>{done}</div>;
}
