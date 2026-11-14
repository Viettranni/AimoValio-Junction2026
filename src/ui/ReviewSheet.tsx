'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Draft, DraftLine, UiLang } from '@/contracts';
import type { OfferLine } from '@/gateway/types';
import { formatDateTime, formatDay, formatMoney, formatQty, formatTime } from './format';
import { dietLabel, t } from './i18n';
import { ArrowLeftIcon, CheckIcon, ClockIcon, HistoryIcon } from './icons';
import { approvalReasons, firstName, offerCountdown, priceChanges, roleLabel } from './offerCard';
import { shortName } from './productName';
import type { Checkout } from './session';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './styles';

/** Re-render once a second while an offer's countdown runs. */
function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Everything the buyer is about to approve, as a binding gateway offer: fixed prices with a countdown, then the
 * single primary action. Approve places the offer through the gateway (same policy as every agent); larger orders
 * go to the named approver and this card waits calmly for the decision.
 */
export function ReviewSheet({
  draft,
  checkout,
  onRequestOffer,
  onPlace,
  onBack,
  onBackToDraft,
  onOpenAudit,
  audit,
  lang,
}: {
  draft: Draft;
  checkout: Checkout;
  onRequestOffer: () => void;
  /** Called with the unknown-allergen lines the buyer ticked (their human-in-the-loop sign-off). */
  onPlace: (allergenLineIds: string[]) => void;
  onBack: () => void;
  /** After a rejection: back to the editable draft. */
  onBackToDraft: () => void;
  onOpenAudit: () => void;
  /** The rendered decision log, shown when present. */
  audit?: React.ReactNode;
  lang: UiLang;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const requested = useRef(false);
  useEffect(() => {
    // Opening Review asks the gateway for an offer (once per mount, also under StrictMode).
    if (requested.current) return;
    requested.current = true;
    onRequestOffer();
  }, [onRequestOffer]);

  const offer = checkout.kind === 'offer' ? checkout : null;
  const now = useTick(offer !== null);
  const countdown = offer ? offerCountdown(offer.offer.validUntil, now, offer.skewMs) : null;
  const expired = countdown?.expired ?? false;

  const { intake } = draft;
  const money = (n: number, d = 0) => formatMoney(n, lang, d);
  const substitutes = draft.lines.filter((l) => l.substituteFor);
  const pendingNotes = draft.lines.filter(
    (l) => l.history?.choice === 'pending' && l.history.historyPacks !== l.history.suggestedPacks,
  ).length;
  const diets = intake.diets && intake.diets !== 'none' ? intake.diets : [];
  const draftById = new Map(draft.lines.map((l) => [l.id, l]));
  const isUnknown = (ol: OfferLine) => {
    const dl = draftById.get(ol.lineId);
    return ol.allergen?.verdict === 'unknown' || (!!dl && (dl.allergen.verdict === 'unknown' || dl.tags.includes('allergens_unknown')));
  };
  const isFail = (ol: OfferLine) => ol.allergen?.verdict === 'fail' || draftById.get(ol.lineId)?.allergen.verdict === 'fail';
  const lines = offer?.offer.lines ?? [];
  const orderable = lines.filter((l) => l.available);
  const unknown = orderable.filter((l) => isUnknown(l) && !isFail(l));
  const conflicting = orderable.filter(isFail);
  const canApprove = !!offer && !expired && !offer.placing && orderable.length > 0 && conflicting.length === 0 && unknown.every((l) => checked[l.lineId]);
  const changes = offer ? priceChanges(offer.changes, offer.offer, lang) : [];
  const total = offer?.offer.totals.total ?? draft.lines.reduce((s, l) => s + (l.unitPrice ?? 0) * l.packs, 0);
  const totalWithTax = offer?.offer.totals.totalWithTax ?? draft.lines.reduce((s, l) => s + (l.unitPriceWithTax ?? 0) * l.packs, 0);
  const overBy = draft.totals.budget !== null && total > draft.totals.budget ? total - draft.totals.budget : null;

  const lineNote = (l: OfferLine) => {
    if (!l.available) return <p className="text-[11.5px] font-medium text-warn">{t('offer.unavailable', lang)}</p>;
    if (isFail(l)) return <p className="text-[11.5px] font-medium text-danger">{t('review.allergenFail', lang)}</p>;
    if (!isUnknown(l)) return null;
    return (
      <label className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-danger">
        <input
          type="checkbox"
          checked={Boolean(checked[l.lineId])}
          onChange={(e) => setChecked((c) => ({ ...c, [l.lineId]: e.target.checked }))}
          className="h-3.5 w-3.5 accent-[var(--blue)]"
        />
        {t('review.confirmUnknown', lang)}
      </label>
    );
  };

  const draftLineRow = (l: DraftLine) => (
    <li key={l.id} className="py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-navy" title={l.productName}>{shortName(l.productName)}</span>
        <span className="flex flex-none items-baseline gap-4 tabular-nums">
          <span className="text-ink-soft">{formatQty(l.quantity, l.unit, lang)}</span>
          <span className="w-20 text-right font-medium text-navy">{l.unitPrice === null ? '—' : money(l.unitPrice * l.packs, 2)}</span>
        </span>
      </div>
    </li>
  );

  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-[10px] border border-line bg-white shadow-card">
      <header className="flex items-baseline justify-between gap-3 border-b-2 border-blue px-4 pb-3 pt-3.5">
        <h2 className="font-display text-[19px] font-bold uppercase leading-none tracking-[0.02em] text-navy">{t('review.title', lang)}</h2>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[12px] font-medium text-blue hover:underline">
          <ArrowLeftIcon size={13} />
          {t('review.back', lang)}
        </button>
      </header>

      <div className="aimo-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px]">
          <Fact label={t('review.delivery', lang)} value={intake.deliveryDate ? formatDay(intake.deliveryDate, lang) : '—'} />
          <Fact label={t('review.orderBy', lang)} value={(offer?.offer.cutoff ?? draft.cutoff) ? formatDateTime((offer?.offer.cutoff ?? draft.cutoff)!, lang) : '—'} />
          <Fact label={t('review.guests', lang)} value={String(intake.guests ?? '—')} />
          <Fact
            label={t('review.diets', lang)}
            value={
              diets.length ? (
                <span className="inline-flex items-center gap-1">
                  <CheckIcon size={12} strokeWidth={2.6} className="text-ok" />
                  {diets.map((d) => `${d.guests} ${dietLabel(d.diet, lang)}`).join(' · ')} {t('review.covered', lang)}
                </span>
              ) : (
                t('review.dietsNone', lang)
              )
            }
          />
        </dl>

        <StatusCard checkout={checkout} countdown={countdown} lang={lang} onRefresh={onRequestOffer} onBackToDraft={onBackToDraft} />

        {changes.length > 0 && (
          <section className="mt-3 rounded-lg bg-warn/10 px-3 py-2.5 text-[12px] text-ink">
            <p className="font-medium text-warn">{t(offer?.requoted ? 'offer.requoted' : 'offer.changed', lang)}</p>
            <ul className="mt-1 space-y-0.5 tabular-nums">
              {changes.map((c) => (
                <li key={c.lineId} className="flex justify-between gap-3">
                  <span className="truncate">{c.name}</span>
                  <span className="flex-none font-medium text-navy">{c.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {offer?.requoted && changes.length === 0 && <Notice tone="warn">{t('offer.requoted', lang)}</Notice>}

        {substitutes.length > 0 && (
          <section className="mt-4 rounded-lg bg-sky px-3 py-2.5">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-blue">{t('review.subs', lang)}</h3>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-navy">
              {substitutes.map((l) => (
                <li key={l.id}>
                  <span title={l.substituteFor!.productName}>{shortName(l.substituteFor!.productName)}</span> →{' '}
                  <b className="font-semibold" title={l.productName}>{shortName(l.productName)}</b>
                  <span className="text-ink-soft"> · {l.substituteFor!.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pendingNotes > 0 && (
          <p className="aimo-glow mt-3 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11.5px] text-ink-soft">
            <HistoryIcon size={14} className="flex-none text-warm-icon" />
            {t('review.pending', lang, { n: pendingNotes })}
          </p>
        )}

        {offer && unknown.length > 0 && <Notice tone="danger">{t('review.unknownNote', lang, { n: unknown.length })}</Notice>}

        <h3 className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted">
          {t('review.lines', lang)} · {offer ? lines.length : draft.lines.length}
        </h3>
        <ul className="mt-1 divide-y divide-line text-[12.5px]">
          {offer
            ? lines.map((l) => (
                <li key={l.lineId} className={`py-1.5 ${l.available ? '' : 'bg-warm'}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`min-w-0 truncate ${l.available ? 'text-navy' : 'text-muted line-through'}`} title={l.productName}>{shortName(l.productName)}</span>
                    <span className="flex flex-none items-baseline gap-4 tabular-nums">
                      <span className="text-ink-soft">{formatQty(l.quantity, l.unit, lang)}</span>
                      <span className="w-20 text-right font-medium text-navy">{l.unitPrice === null || !l.available ? '—' : money(l.lineTotal, 2)}</span>
                    </span>
                  </div>
                  {lineNote(l)}
                </li>
              ))
            : draft.lines.map(draftLineRow)}
        </ul>

        <button type="button" onClick={onOpenAudit} className="mt-3 text-[12px] font-medium text-blue hover:underline">
          {audit ? t('receipt.hideLog', lang) : t('receipt.log', lang)}
        </button>
        {audit && <div className="mt-2 border-t border-line pt-3">{audit}</div>}
      </div>

      <div className="border-t border-line bg-ice px-4 py-3.5">
        <div className="flex items-baseline justify-between text-[12px] text-muted tabular-nums">
          <span>{t('receipt.subtotal', lang)}</span>
          <span>{money(total, 2)}</span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between tabular-nums">
          <span className="text-[13px] font-semibold text-navy">{t('receipt.total', lang)}</span>
          <span className="text-[18px] font-semibold text-navy">{money(totalWithTax, 2)}</span>
        </div>
        {overBy !== null && <p className="mt-1 text-[11.5px] font-medium text-warn">{t('totals.over', lang, { v: money(overBy) })}</p>}
        {(checkout.kind === 'pending' || checkout.kind === 'rejected' || checkout.kind === 'not_orderable') ? null : offer && expired ? (
          <button type="button" onClick={onRequestOffer} className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13.5px] ${PRIMARY_BUTTON}`}>
            {t('offer.refresh', lang)}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onPlace(unknown.filter((l) => checked[l.lineId]).map((l) => l.lineId))}
            disabled={!canApprove}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13.5px] ${PRIMARY_BUTTON}`}
          >
            {offer?.placing && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-lime-ink/30 border-t-lime-ink" />}
            {t('review.approve', lang)}
          </button>
        )}
        <p className="mt-1.5 text-center text-[11px] text-muted">{t('review.simulated', lang)}</p>
      </div>
    </div>
  );
}

/** The offer (fixed prices + countdown), or where the order stands: waiting for approval, rejected, not orderable. */
function StatusCard({
  checkout,
  countdown,
  lang,
  onRefresh,
  onBackToDraft,
}: {
  checkout: Checkout;
  countdown: ReturnType<typeof offerCountdown> | null;
  lang: UiLang;
  onRefresh: () => void;
  onBackToDraft: () => void;
}) {
  const body = (() => {
    switch (checkout.kind) {
      case 'idle':
      case 'quoting':
        return (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-blue/25 border-t-blue" />
            {t('offer.loading', lang)}
          </div>
        );
      case 'offer':
        return (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${countdown?.expired ? 'text-warn' : 'text-navy'}`}>
                <ClockIcon size={14} className="flex-none" />
                {countdown?.expired ? t('offer.expired', lang) : t('offer.fixedUntil', lang, { time: formatTime(checkout.offer.validUntil, lang) })}
              </p>
              <p className="mt-0.5 text-[11px] text-muted tabular-nums">{t('offer.id', lang, { id: checkout.offer.offerId })}</p>
            </div>
            {countdown?.expired ? (
              <button type="button" onClick={onRefresh} className={`flex-none rounded-lg px-3 py-1.5 text-[12px] ${SECONDARY_BUTTON}`}>
                {t('offer.refresh', lang)}
              </button>
            ) : (
              <span className="flex-none rounded-md bg-white px-2 py-1 font-display text-[16px] font-bold leading-none text-navy tabular-nums" aria-live="off">
                {t('offer.left', lang, { t: countdown?.label ?? '' })}
              </span>
            )}
          </div>
        );
      case 'pending':
        return (
          <div>
            <p className="flex items-center gap-2 text-[13px] font-semibold text-navy">
              <span className="relative flex h-2.5 w-2.5 flex-none">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-70 motion-reduce:hidden" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-lime" />
              </span>
              {t('pending.title', lang, { name: checkout.approver.name, role: roleLabel(checkout.approver.role, lang) })}
            </p>
            <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted">{t('pending.why', lang)}</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12px] text-ink-soft">
              {approvalReasons(checkout.reasons, checkout, lang).map((r) => <li key={r}>{r}</li>)}
            </ul>
            <p className="mt-2 text-[12px] text-navy">{t('pending.wait', lang, { first: firstName(checkout.approver.name) })}</p>
          </div>
        );
      case 'rejected':
        return (
          <div>
            <p className="text-[13px] font-semibold text-navy">
              {checkout.decidedBy ? t('rejected.title', lang, { name: checkout.decidedBy }) : t('rejected.titleNoName', lang)}
            </p>
            {checkout.note && <p className="mt-1 rounded-md bg-white px-2 py-1 text-[12px] italic text-ink-soft">“{checkout.note}”</p>}
            <p className="mt-1 text-[12px] text-ink-soft">{t('rejected.body', lang)}</p>
            <button type="button" onClick={onBackToDraft} className={`mt-2 rounded-lg px-3 py-1.5 text-[12px] ${SECONDARY_BUTTON}`}>
              {t('rejected.back', lang)}
            </button>
          </div>
        );
      case 'not_orderable':
        return (
          <div>
            <p className="text-[13px] font-semibold text-warn">{t('notOrderable.title', lang)}</p>
            <p className="mt-1 text-[12px] text-ink-soft">{t('notOrderable.body', lang)}</p>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-medium text-warn">{t('offer.failed', lang)}</p>
            <button type="button" onClick={onRefresh} className={`flex-none rounded-lg px-3 py-1.5 text-[12px] ${SECONDARY_BUTTON}`}>
              {t('offer.refresh', lang)}
            </button>
          </div>
        );
    }
  })();
  const tone = checkout.kind === 'pending' ? 'border-lime bg-lime/10' : checkout.kind === 'rejected' || checkout.kind === 'not_orderable' || checkout.kind === 'error' ? 'border-warn/40 bg-warn/5' : 'border-blue/20 bg-sky';
  return (
    <section className={`mt-4 min-h-[58px] rounded-lg border px-3 py-2.5 transition-colors ${tone}`} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={checkout.kind} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
          {body}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-navy tabular-nums">{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'danger'; children: React.ReactNode }) {
  return (
    <p className={`mt-3 rounded-lg px-2.5 py-2 text-[11.5px] font-medium ${tone === 'warn' ? 'bg-warn/10 text-warn' : 'bg-danger/10 text-danger'}`}>
      {children}
    </p>
  );
}
