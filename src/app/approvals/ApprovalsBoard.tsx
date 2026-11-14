'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Receipt } from '@/contracts';
import type { Approval, Change, Offer } from '@/gateway/types';
import { PRIMARY_BUTTON } from '@/ui/styles';

type Row = { approval: Approval; offer: Offer | null; customerName: string };
type Outcome =
  | { status: 'ordered'; receipt: Receipt }
  | { status: 'rejected' }
  | { status: 'requote'; newOffer: Offer; changes: Change[] }
  | { status: 'error'; message: string };

const eur = (n: number) => `€${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
    <div className="mx-auto max-w-5xl px-4 py-6">
      {loadError && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">Could not load approvals ({loadError}).</p>}
      <h2 className="font-display text-[20px] font-bold uppercase tracking-[0.02em] text-navy">Waiting for you · {pending.length}</h2>
      {rows === null ? (
        <p className="mt-3 text-[13px] text-muted">Loading…</p>
      ) : pending.length === 0 ? (
        <p className="mt-3 rounded-[10px] border border-line bg-white px-4 py-5 text-[13.5px] text-muted">
          Nothing to approve. Orders within an agent&apos;s authority go straight through.
        </p>
      ) : (
        <div className="mt-3 space-y-4">{pending.map((r) => <ApprovalCard key={r.approval.approvalId} row={r} onDone={load} />)}</div>
      )}
      {decided.length > 0 && (
        <>
          <h2 className="mt-8 font-display text-[20px] font-bold uppercase tracking-[0.02em] text-navy">Decided</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-white">
            {decided.map(({ approval: a, offer }) => (
              <li key={a.approvalId} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-[13px]">
                <span className="font-medium text-navy">{a.approvalId} · {a.agentName}</span>
                <span className="text-muted">{offer ? `${eur(offer.totals.total)} excl. VAT · ` : ''}{a.decidedAt ? when(a.decidedAt) : ''}</span>
                <span className={a.status === 'approved' ? 'font-semibold text-ok' : a.status === 'rejected' ? 'font-semibold text-danger' : 'font-semibold text-warn'}>
                  {a.status === 'approved' ? `Approved → ${a.orderId}` : a.status === 'rejected' ? 'Rejected' : `Re-quoted → ${a.newOfferId}`}
                  {a.decidedBy ? ` by ${a.decidedBy}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
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
    <article className="overflow-hidden rounded-[10px] border border-line bg-white shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{a.approvalId} · offer {a.offerId}</p>
          <h3 className="font-display text-[22px] font-bold uppercase leading-tight text-navy">{a.agentName}</h3>
          <p className="text-[13px] text-ink-soft">
            for {customerName} · requested {when(a.createdAt)}
            {offer && <> · delivery {offer.deliveryDate}{offer.cutoff && <> · order by {when(offer.cutoff)}</>}</>}
          </p>
        </div>
        {offer && (
          <div className="text-right">
            <p className="font-display text-[28px] font-extrabold leading-none text-navy">{eur(offer.totals.total)}</p>
            <p className="text-[12px] text-muted">excl. VAT · {eur(offer.totals.totalWithTax)} incl.</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-warm-ink">Why it needs you</p>
        <ul className="mt-1.5 space-y-1">
          {a.reasons.map((r) => (
            <li key={r.rule} className="rounded-md bg-warm px-2.5 py-1.5 text-[13px] text-warm-ink">{r.message}</li>
          ))}
        </ul>

        {offer && (
          <table className="mt-3 w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-muted">
                <th className="py-1 font-semibold">Product</th>
                <th className="py-1 text-right font-semibold">Packs</th>
                <th className="py-1 text-right font-semibold">Per pack</th>
                <th className="py-1 text-right font-semibold">Line</th>
              </tr>
            </thead>
            <tbody>
              {offer.lines.map((l) => (
                <tr key={l.lineId} className={`border-t border-line ${l.available ? '' : 'text-muted'}`}>
                  <td className="py-1.5 pr-2">
                    <span className="text-navy">{l.productName}</span>
                    <span className="block text-[11.5px] text-muted">{l.packDescription}{l.available ? '' : ` · not ordered: ${l.reason ?? l.status}`}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{l.packs}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.unitPrice === null ? '—' : eur(l.unitPrice)}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.available ? eur(l.lineTotal) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-line bg-sky/50 px-4 py-3">
        {outcome ? (
          <OutcomeView outcome={outcome} onDone={onDone} />
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-[11.5px] font-semibold text-muted">
              Approver
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-0.5 w-48 rounded-md border border-line bg-white px-2 py-1.5 text-[13px] font-normal text-ink" />
            </label>
            <label className="flex min-w-48 flex-1 flex-col text-[11.5px] font-semibold text-muted">
              Note (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. OK for the gala" className="mt-0.5 rounded-md border border-line bg-white px-2 py-1.5 text-[13px] font-normal text-ink" />
            </label>
            <button disabled={!!busy || !name.trim()} onClick={() => decide('reject')} className="rounded-lg border border-line bg-white px-4 py-2 text-[13.5px] font-semibold text-danger disabled:opacity-40">
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
            <button disabled={!!busy || !name.trim()} onClick={() => decide('approve')} className={`rounded-lg px-5 py-2 text-[13.5px] ${PRIMARY_BUTTON}`}>
              {busy === 'approve' ? 'Checking Valio…' : 'Approve'}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function OutcomeView({ outcome, onDone }: { outcome: Outcome; onDone: () => void }) {
  const done = <button onClick={onDone} className="ml-auto text-[12.5px] font-semibold text-blue underline">Refresh list</button>;
  if (outcome.status === 'ordered') {
    const r = outcome.receipt;
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
        <span className="font-semibold text-ok">Ordered {r.orderId}</span>
        <span className="text-ink-soft">· {r.lines.length} line(s) · {eur(r.total)} excl. VAT · delivery {r.deliveryDate} · simulated order, nothing is charged</span>
        {done}
      </div>
    );
  }
  if (outcome.status === 'requote') {
    return (
      <div className="text-[13.5px]">
        <p className="font-semibold text-warn">Prices or stock changed, so nothing was ordered. New offer {outcome.newOffer.offerId} ({eur(outcome.newOffer.totals.total)}) went back to the agent.</p>
        <ul className="mt-1 list-disc pl-5 text-ink-soft">{outcome.changes.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
        <div className="mt-1 flex">{done}</div>
      </div>
    );
  }
  if (outcome.status === 'rejected') return <div className="flex text-[13.5px]"><span className="font-semibold text-danger">Rejected. The agent sees this in getOrderStatus.</span>{done}</div>;
  return <div className="flex text-[13.5px]"><span className="font-semibold text-danger">{outcome.message}</span>{done}</div>;
}
