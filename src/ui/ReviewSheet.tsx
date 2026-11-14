'use client';

import { useState } from 'react';
import type { Draft, DraftLine, UiLang } from '@/contracts';
import { formatDateTime, formatDay, formatMoney, formatQty } from './format';
import { dietLabel, t } from './i18n';
import { ArrowLeftIcon, CheckIcon, HistoryIcon } from './icons';
import type { ApproveResult } from './session';
import { PRIMARY_BUTTON } from './styles';

/** Everything the buyer is about to approve, on one card, with the single primary action. */
export function ReviewSheet({
  draft,
  onApprove,
  onBack,
  onOpenAudit,
  audit,
  problems,
  lang,
}: {
  draft: Draft;
  onApprove: () => Promise<unknown>;
  onBack: () => void;
  onOpenAudit: () => void;
  /** The rendered decision log, shown when present. */
  audit?: React.ReactNode;
  /** Problems from the last approval attempt; they stand until the draft changes. */
  problems?: ApproveResult['problems'];
  lang: UiLang;
}) {
  const [sending, setSending] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);
  const { intake, totals } = draft;
  const money = (n: number, d = 0) => formatMoney(n, lang, d);
  const substitutes = draft.lines.filter((l) => l.substituteFor);
  const pending = draft.lines.filter(
    (l) => l.history?.choice === 'pending' && l.history.historyPacks !== l.history.suggestedPacks,
  ).length;
  const total = draft.lines.reduce((s, l) => s + (l.unitPrice ?? 0) * l.packs, 0);
  const totalWithTax = draft.lines.reduce((s, l) => s + (l.unitPriceWithTax ?? 0) * l.packs, 0);
  const diets = intake.diets && intake.diets !== 'none' ? intake.diets : [];
  const unknown = draft.lines.filter((l) => l.tags.includes('allergens_unknown'));
  const unpriced = draft.lines.filter((l) => l.unitPrice === null);
  const lineProblems: Record<string, string> = Object.fromEntries((problems ?? []).filter((p) => p.lineId).map((p) => [p.lineId, p.reason]));
  const generalProblems = (problems ?? []).filter((p) => !p.lineId).map((p) => p.reason);
  const canApprove =
    draft.lines.length > 0 && unpriced.length === 0 && unknown.every((l) => checked[l.id]) && !problems?.length;

  const approve = async () => {
    setSending(true);
    setFailed(false);
    try {
      await onApprove();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const lineNote = (l: DraftLine) => {
    if (lineProblems[l.id]) return <p className="text-[11.5px] font-medium text-warn">{lineProblems[l.id]}</p>;
    if (l.unitPrice === null) return <p className="text-[11.5px] font-medium text-warn">{t('review.noPriceLine', lang)}</p>;
    if (!l.tags.includes('allergens_unknown')) return null;
    return (
      <label className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-danger">
        <input
          type="checkbox"
          checked={Boolean(checked[l.id])}
          onChange={(e) => setChecked((c) => ({ ...c, [l.id]: e.target.checked }))}
          className="h-3.5 w-3.5 accent-[var(--blue)]"
        />
        {t('review.confirmUnknown', lang)}
      </label>
    );
  };

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
          <Fact label={t('review.orderBy', lang)} value={draft.cutoff ? formatDateTime(draft.cutoff, lang) : '—'} />
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

        {substitutes.length > 0 && (
          <section className="mt-4 rounded-lg bg-sky px-3 py-2.5">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-blue">{t('review.subs', lang)}</h3>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-navy">
              {substitutes.map((l) => (
                <li key={l.id}>
                  {l.substituteFor!.productName} → <b className="font-semibold">{l.productName}</b>
                  <span className="text-ink-soft"> · {l.substituteFor!.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pending > 0 && (
          <p className="aimo-glow mt-3 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11.5px] text-ink-soft">
            <HistoryIcon size={14} className="flex-none text-warm-icon" />
            {t('review.pending', lang, { n: pending })}
          </p>
        )}

        {generalProblems.length > 0 && <Notice tone="warn">{generalProblems.join(' ')}</Notice>}
        {generalProblems.length === 0 && Object.keys(lineProblems).length > 0 && (
          <Notice tone="warn">{t('review.problems', lang)}</Notice>
        )}
        {unpriced.length > 0 && <Notice tone="warn">{t('review.noPrice', lang, { n: unpriced.length })}</Notice>}
        {unknown.length > 0 && <Notice tone="danger">{t('review.unknownNote', lang, { n: unknown.length })}</Notice>}

        <h3 className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted">
          {t('review.lines', lang)} · {draft.lines.length}
        </h3>
        <ul className="mt-1 divide-y divide-line text-[12.5px]">
          {draft.lines.map((l) => (
            <li key={l.id} className={`py-1.5 ${lineProblems[l.id] ? 'bg-warm' : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-navy">{l.productName}</span>
                <span className="flex flex-none items-baseline gap-4 tabular-nums">
                  <span className="text-ink-soft">{formatQty(l.quantity, l.unit, lang)}</span>
                  <span className="w-20 text-right font-medium text-navy">
                    {l.unitPrice === null ? '—' : money(l.unitPrice * l.packs, 2)}
                  </span>
                </span>
              </div>
              {lineNote(l)}
            </li>
          ))}
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
        {totals.overBudget && totals.budget !== null && (
          <p className="mt-1 text-[11.5px] font-medium text-warn">{t('totals.over', lang, { v: money(total - totals.budget) })}</p>
        )}
        <button
          type="button"
          onClick={approve}
          disabled={sending || !canApprove}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13.5px] ${PRIMARY_BUTTON}`}
        >
          {sending && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-lime-ink/30 border-t-lime-ink" />}
          {t('review.approve', lang)}
        </button>
        {failed && <p className="mt-1.5 text-center text-[11.5px] font-medium text-warn">{t('review.failed', lang)}</p>}
        <p className="mt-1.5 text-center text-[11px] text-muted">{t('review.simulated', lang)}</p>
      </div>
    </div>
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
