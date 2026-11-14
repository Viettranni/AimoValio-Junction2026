'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { DraftTotals, UiLang } from '@/contracts';
import { CountUp } from './CountUp';
import { formatMoney } from './format';
import { t } from './i18n';
import { PRIMARY_BUTTON } from './styles';

/** Ice-blue footer: estimated total range, budget bar, the one primary action. */
export function TotalsFooter({
  totals,
  onReview,
  settling,
  lang,
}: {
  totals: DraftTotals;
  /** Omitted once the order is sent: there is nothing left to review. */
  onReview?: () => void;
  /** While lines are still arriving the total is not final, so it is not shown yet. */
  settling?: boolean;
  lang: UiLang;
}) {
  const money = (n: number) => formatMoney(n, lang);
  // A range until every history choice is made, then one number (a range of equal ends is one number too).
  const single = totals.collapsed || Math.round(totals.low) === Math.round(totals.high);
  const budget = totals.budget;
  const used = budget ? Math.min(totals.high / budget, 1) : 0;

  return (
    <div className="flex items-end justify-between gap-4 border-t border-line bg-ice px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-muted">{t('totals.label', lang)}</div>
        <AnimatePresence mode="wait" initial={false}>
          {settling ? (
            <motion.div key="settling" exit={{ opacity: 0 }} className="mt-1.5 space-y-1.5">
              <div className="aimo-shimmer h-5 w-40 rounded" />
              <div className="text-[11px] text-muted">{t('totals.settling', lang)}</div>
            </motion.div>
          ) : (
            <motion.div key="total" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <div className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-navy">
                {single ? (
                  <CountUp value={totals.high} format={money} />
                ) : (
                  <>
                    <CountUp value={totals.low} format={money} /> – <CountUp value={totals.high} format={money} />
                  </>
                )}
              </div>
              <div className="text-[11px] text-muted tabular-nums">
                {t('totals.exVat', lang)} ·{' '}
                {t('totals.incVat', lang, {
                  v: single ? money(totals.highWithTax) : `${money(totals.lowWithTax)}–${money(totals.highWithTax)}`,
                })}
              </div>
              {budget !== null && (
                <div className="mt-2 max-w-[260px]">
                  <div className="h-1.5 overflow-hidden rounded-full bg-sky">
                    <motion.div
                      className={`h-full rounded-full ${totals.overBudget ? 'bg-warn' : 'bg-blue'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${used * 100}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <div className={`mt-1 text-[11px] tabular-nums ${totals.overBudget ? 'font-medium text-warn' : 'text-muted'}`}>
                    {totals.overBudget
                      ? t('totals.over', lang, { v: money(totals.high - budget) })
                      : t('totals.budget', lang, { v: money(budget) })}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {onReview && (
        <button
          type="button"
          onClick={onReview}
          disabled={settling}
          className={`flex-none rounded-lg px-4 py-2.5 text-[13px] ${PRIMARY_BUTTON}`}
        >
          {t('totals.review', lang)}
        </button>
      )}
    </div>
  );
}
