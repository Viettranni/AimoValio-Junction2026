'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { DraftTotals, Intake, UiLang } from '@/contracts';
import { SHEET_COLUMNS } from './DraftRow';
import { formatDay } from './format';
import { t } from './i18n';
import { LimeBar, ShelfGlyph } from './ShelfShuffle';
import { REDUCED_ROLL_MS, rollIndex } from './shelf';
import { TotalsFooter } from './TotalsFooter';
import { useShelf, useTick } from './useProductSample';

export const SKELETON_ROWS = 5;
/** Skeleton names roll slower than the chat card: the sheet should feel like it is filling, not flickering. */
const SKELETON_ROLL_MS = 900;
/** Same height as a draft row without tags or notes, so the swap to real rows does not jump. */
const ROW_HEIGHT = 'h-[58px]';

const WIDTHS = ['w-[62%]', 'w-[48%]', 'w-[70%]', 'w-[55%]', 'w-[40%]', 'w-[66%]'];

/** A placeholder draft row whose name slot cycles through catalogue products under a soft shimmer. */
export function SkeletonRow({ index }: { index: number }) {
  const { products, running } = useShelf();
  const reduce = !!useReducedMotion();
  // Slightly different speeds keep the rows from flipping in lockstep.
  const tick = useTick(reduce ? REDUCED_ROLL_MS : SKELETON_ROLL_MS + index * 110, running && products.length > 1);
  // Rows start evenly spread through the sample and stride through it, so neighbours rarely match.
  const spread = Math.max(1, Math.floor(products.length / SKELETON_ROWS));
  const product = products.length ? products[rollIndex(tick * SKELETON_ROWS, products.length, index * spread)] : undefined;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: index * 0.06 } }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className={`${ROW_HEIGHT} border-b border-line last:border-b-0`}
      aria-hidden="true"
    >
      <div className={`${SHEET_COLUMNS} h-full px-4`}>
        <div className="min-w-0">
          <div className="relative h-[18px] overflow-hidden">
            {product ? (
              <AnimatePresence initial={false}>
                <motion.div
                  key={`${product.id}-${tick}`}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 flex items-center gap-1.5 text-[13px] leading-[18px] text-muted/70"
                >
                  <span className="flex-none text-blue/40">
                    <ShelfGlyph group={product.group} size={12} />
                  </span>
                  <span className="truncate">{product.displayName}</span>
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className={`aimo-shimmer h-3 rounded ${WIDTHS[index % WIDTHS.length]}`} />
            )}
          </div>
          <div className={`aimo-shimmer mt-1.5 h-2.5 rounded ${WIDTHS[(index + 2) % WIDTHS.length]} max-w-[120px]`} />
        </div>
        <div className="aimo-shimmer h-6 w-[106px] rounded-md" />
        <div className="aimo-shimmer ml-auto h-3.5 w-12 rounded" />
        <span />
      </div>
    </motion.div>
  );
}

const PENDING_TOTALS: DraftTotals = { low: 0, high: 0, lowWithTax: 0, highWithTax: 0, collapsed: false, budget: null, overBudget: false };

/**
 * The order sheet before the draft exists: same frame as DraftSheet (header, column labels, footer) with
 * skeleton rows, so the panel opens as soon as planning starts and real rows replace these in place.
 */
export function SkeletonSheet({ intake, lang }: { intake: Intake | null; lang: UiLang }) {
  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-[10px] border border-line bg-white shadow-card" aria-busy="true">
      <header className="relative flex items-baseline justify-between gap-3 border-b-2 border-blue px-4 pb-3 pt-3.5">
        <h2 className="font-display text-[19px] font-bold uppercase leading-none tracking-[0.02em] text-navy">{t('sheet.title', lang)}</h2>
        <span className="truncate text-[12px] text-muted tabular-nums">
          {intake?.eventName}
          {intake?.deliveryDate && ` · ${formatDay(intake.deliveryDate, lang)}`}
          {intake?.guests && ` · ${t('sheet.guests', lang, { n: intake.guests })}`}
        </span>
        <LimeBar className="absolute inset-x-0 -bottom-[2px]" />
      </header>
      <div className="px-4 pt-2 text-[11.5px] text-muted">{t('sheet.building', lang)}</div>
      <div className={`${SHEET_COLUMNS} mt-2 bg-ice px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.07em] text-muted`}>
        <span>{t('sheet.product', lang)}</span>
        <span className="min-w-[106px] text-center">{t('sheet.qty', lang)}</span>
        <span className="text-right">{t('sheet.price', lang)}</span>
        <span />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pt-3">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <SkeletonRow key={i} index={i} />
        ))}
      </div>
      <TotalsFooter totals={PENDING_TOTALS} onReview={() => {}} settling lang={lang} />
    </div>
  );
}
