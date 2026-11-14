'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { Draft, DraftChange, DraftDiff, DraftLine, PortionCategory, UiLang } from '@/contracts';
import { CountUp } from './CountUp';
import { DraftRow, SHEET_COLUMNS } from './DraftRow';
import { formatDateTime, formatDay } from './format';
import { t, type UiKey } from './i18n';
import { TotalsFooter } from './TotalsFooter';

const GROUP_OF: Record<PortionCategory, UiKey> = {
  poultry_main: 'group.protein',
  meat_main: 'group.protein',
  fish_main: 'group.protein',
  veg_main: 'group.protein',
  grain_side: 'group.sides',
  potato_side: 'group.sides',
  veg_side: 'group.sides',
  sauce: 'group.sauce',
  salad: 'group.salad',
  bread: 'group.bread',
  dairy: 'group.bread',
  dessert: 'group.dessert',
  beverage: 'group.drinks',
  cooking_fat: 'group.basics',
  seasoning: 'group.basics',
};

const GROUP_ORDER: UiKey[] = [
  'group.protein', 'group.sides', 'group.sauce', 'group.salad',
  'group.bread', 'group.dessert', 'group.drinks', 'group.basics',
];

export function groupLines(lines: DraftLine[]): Array<{ key: UiKey; lines: DraftLine[] }> {
  return GROUP_ORDER.map((key) => ({ key, lines: lines.filter((l) => GROUP_OF[l.group] === key) })).filter(
    (g) => g.lines.length > 0,
  );
}

/** The order draft "working sheet": clearly not chat, same product. */
export function DraftSheet({
  draft,
  diff,
  onChange,
  onReview,
  problems,
  lang,
}: {
  draft: Draft;
  diff: DraftDiff | null;
  onChange: (change: DraftChange) => void;
  onReview: () => void;
  /** Reasons from a failed approval, by line id, shown on the rows until the draft changes. */
  problems?: Record<string, string>;
  lang: UiLang;
}) {
  const { intake } = draft;
  const changed = new Set(diff?.changedLineIds ?? []);
  const groups = groupLines(draft.lines);

  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-[10px] border border-line bg-white shadow-card">
      <header className="flex items-baseline justify-between gap-3 border-b-2 border-blue px-4 pb-3 pt-3.5">
        <h2 className="font-display text-[19px] font-bold uppercase leading-none tracking-[0.02em] text-navy">{t('sheet.title', lang)}</h2>
        <span className="truncate text-[12px] text-muted tabular-nums">
          {intake.eventName}
          {intake.deliveryDate && ` · ${formatDay(intake.deliveryDate, lang)}`}
          {intake.guests && (
            <>
              {' · '}
              <CountUp value={intake.guests} format={(n) => t('sheet.guests', lang, { n: Math.round(n) })} />
            </>
          )}
        </span>
      </header>
      {draft.cutoff && intake.deliveryDate && (
        <div className="px-4 pt-2 text-[11.5px] text-muted">
          {t('sheet.delivery', lang, { d: formatDay(intake.deliveryDate, lang) })} ·{' '}
          <span className="font-medium text-ink-soft">{t('sheet.orderBy', lang, { d: formatDateTime(draft.cutoff, lang) })}</span>
        </div>
      )}

      <div className={`${SHEET_COLUMNS} mt-2 bg-ice px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.07em] text-muted`}>
        <span>{t('sheet.product', lang)}</span>
        <span className="min-w-[106px] text-center">{t('sheet.qty', lang)}</span>
        <span className="text-right">{t('sheet.price', lang)}</span>
        <span />
      </div>

      <div className="aimo-scroll min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 && draft.status !== 'building' && (
          <p className="px-4 py-6 text-center text-[12.5px] text-muted">{t('sheet.empty', lang)}</p>
        )}
        <AnimatePresence initial={false}>
          {groups.map((group) => (
            <motion.section
              key={group.key}
              layout="position"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <h3 className="px-4 pb-0.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                {t(group.key, lang)}
              </h3>
              <AnimatePresence initial={false}>
                {group.lines.map((line) => (
                  <DraftRow
                    key={line.id}
                    line={line}
                    lang={lang}
                    onChange={onChange}
                    readOnly={draft.status === 'submitted'}
                    flashKey={changed.has(line.id) ? draft.updatedAt : undefined}
                    problem={problems?.[line.id]}
                  />
                ))}
              </AnimatePresence>
            </motion.section>
          ))}
        </AnimatePresence>
      </div>

      <TotalsFooter totals={draft.totals} onReview={draft.status === 'submitted' ? undefined : onReview} settling={draft.status === 'building'} lang={lang} />
    </div>
  );
}
