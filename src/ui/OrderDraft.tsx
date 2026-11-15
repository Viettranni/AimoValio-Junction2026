'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { Draft, DraftChange, DraftDiff, DraftLine, Intake, LineTag, UiLang } from '@/contracts';
import { CountUp } from './CountUp';
import { groupLines } from './DraftSheet';
import { formatDateTime, formatDay, formatMoney, formatQty } from './format';
import { HistoryNote } from './HistoryNote';
import { t, type UiKey } from './i18n';
import { CloseIcon, MinusIcon, PlusIcon } from './icons';
import { shortName } from './productName';
import { LimeBar } from './ShelfShuffle';
import { SKELETON_ROWS } from './SkeletonRows';

/** The one status a row shows under its name, most serious first, with its colour. */
const STATUS: Array<[LineTag, UiKey, string]> = [
  ['unavailable', 'status.unavailable', 'text-danger'],
  ['allergens_unknown', 'status.allergens_unknown', 'text-app-amber'],
  ['may_deliver_short', 'status.may_deliver_short', 'text-app-amber'],
  ['substitute', 'status.substitute', 'text-app-amber'],
  ['supplier_delivered', 'status.supplier_delivered', 'text-app-teal'],
  ['in_stock', 'status.in_stock', 'text-app-teal'],
];
const STATUS_TAGS = new Set(STATUS.map(([tag]) => tag));

const money = (n: number, lang: UiLang) => formatMoney(n, lang, 2);

/** The card frame shared by the draft, its skeleton and the empty state. */
function Frame({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return (
    <div aria-busy={busy || undefined} className="flex h-full min-h-0 flex-col rounded-2xl bg-white px-5 pb-5 pt-6 shadow-card md:px-8 md:pb-7 md:pt-7">
      {children}
    </div>
  );
}

function Heading({ intake, lang, bar }: { intake: Intake | null; lang: UiLang; bar?: boolean }) {
  const bits = [intake?.eventName, intake?.deliveryDate && formatDay(intake.deliveryDate, lang)].filter(Boolean);
  return (
    <header className="relative flex-none border-b border-line pb-4">
      <h2 className="text-[26px] font-bold leading-tight tracking-[-0.01em] text-navy">{t('sheet.title', lang)}</h2>
      {(bits.length > 0 || intake?.guests) && (
        <p className="mt-1 truncate text-[16px] text-muted tabular-nums">
          {bits.join(' · ')}
          {intake?.guests && (
            <>
              {bits.length > 0 && ' · '}
              <CountUp value={intake.guests} format={(n) => t('sheet.guests', lang, { n: Math.round(n) })} />
            </>
          )}
        </p>
      )}
      {bar && <LimeBar className="absolute inset-x-0 -bottom-px z-10" />}
    </header>
  );
}

/** Before anything is asked: the right-hand card says what will appear there. */
export function OrderDraftEmpty({ lang }: { lang: UiLang }) {
  return (
    <Frame>
      <Heading intake={null} lang={lang} />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-line" aria-hidden="true">
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h3" strokeLinecap="round" />
        </svg>
        <p className="max-w-sm text-[14.5px] leading-relaxed text-muted">{t('draft.emptyHint', lang)}</p>
      </div>
    </Frame>
  );
}

function ShimmerRow({ index }: { index: number }) {
  const widths = ['w-3/5', 'w-2/5', 'w-1/2', 'w-[45%]', 'w-[55%]'];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: index * 0.06 } }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-6 border-b border-line py-4"
    >
      <div className="flex-1">
        <div className={`aimo-shimmer h-4 rounded ${widths[index % widths.length]}`} />
        <div className="aimo-shimmer mt-2 h-3 w-24 rounded" />
      </div>
      <div className="aimo-shimmer h-4 w-12 rounded" />
      <div className="aimo-shimmer h-4 w-16 rounded" />
    </motion.div>
  );
}

/** Planning has started but no draft exists yet. */
export function OrderDraftSkeleton({ intake, lang }: { intake: Intake | null; lang: UiLang }) {
  return (
    <Frame busy>
      <Heading intake={intake} lang={lang} bar />
      <p className="pt-3 text-[13px] text-muted">{t('sheet.building', lang)}</p>
      <div className="min-h-0 flex-1 overflow-hidden">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => <ShimmerRow key={i} index={i} />)}
      </div>
    </Frame>
  );
}

/** The order draft as the Orders page shows it: one row per product, status under the name, total and one action. */
export function OrderDraft({
  draft,
  diff,
  onChange,
  onReview,
  locked,
  editing,
  animateIn,
  lang,
}: {
  draft: Draft;
  diff: DraftDiff | null;
  onChange: (change: DraftChange) => void;
  onReview: () => void;
  locked?: boolean;
  editing?: string[] | null;
  animateIn?: boolean;
  lang: UiLang;
}) {
  const { intake, totals } = draft;
  const changed = new Set(diff?.changedLineIds ?? []);
  const sheetEditing = !!editing && (editing.length === 0 || editing.includes(''));
  const building = draft.status === 'building';
  const readOnly = draft.status === 'submitted' || !!locked;
  const placeholders = building ? Math.max(0, SKELETON_ROWS - draft.lines.length) : 0;
  // Grouped order (protein, sides, sauce…) without the group labels: the design lists products only.
  const lines = groupLines(draft.lines).flatMap((g) => g.lines);
  const single = totals.collapsed || Math.round(totals.low) === Math.round(totals.high);
  const count = draft.lines.length;
  let order = 0;

  return (
    <Frame>
      <Heading intake={intake} lang={lang} bar={sheetEditing} />
      <span role="status" className="sr-only">{sheetEditing ? t('sheet.editing', lang) : ''}</span>
      {draft.cutoff && intake.deliveryDate && (
        <p className="flex-none pt-2.5 text-[12.5px] text-muted">
          {t('sheet.delivery', lang, { d: formatDay(intake.deliveryDate, lang) })} ·{' '}
          <span className="font-medium text-ink-soft">{t('sheet.orderBy', lang, { d: formatDateTime(draft.cutoff, lang) })}</span>
        </p>
      )}

      <div className="aimo-scroll -mx-2 min-h-0 flex-1 overflow-y-auto px-2">
        {lines.length === 0 && !building && <p className="py-10 text-center text-[14px] text-muted">{t('sheet.empty', lang)}</p>}
        <AnimatePresence initial={!!animateIn}>
          {lines.map((line) => (
            <Row
              key={line.id}
              line={line}
              lang={lang}
              onChange={onChange}
              readOnly={readOnly}
              flashKey={changed.has(line.id) ? draft.updatedAt : undefined}
              editing={!!editing?.includes(line.id)}
              enterDelay={animateIn ? Math.min(order++, 10) * 0.045 : 0}
            />
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {Array.from({ length: placeholders }, (_, i) => (
            <ShimmerRow key={`s-${SKELETON_ROWS - placeholders + i}`} index={SKELETON_ROWS - placeholders + i} />
          ))}
        </AnimatePresence>
      </div>

      <footer className="flex-none pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-[15px] text-muted">{count === 1 ? t('draft.items.one', lang) : t('draft.items', lang, { n: count })}</span>
          {building ? (
            <span className="aimo-shimmer h-7 w-48 rounded" aria-label={t('totals.settling', lang)} />
          ) : (
            <span className="text-right text-[22px] font-bold leading-tight tracking-[-0.01em] text-navy tabular-nums md:text-[24px]">
              {single ? (
                <CountUp value={totals.high} format={(n) => money(n, lang)} />
              ) : (
                <>
                  <CountUp value={totals.low} format={(n) => money(n, lang)} /> – <CountUp value={totals.high} format={(n) => money(n, lang)} />
                </>
              )}{' '}
              {t('totals.exVat', lang)}
            </span>
          )}
        </div>
        {!building && (
          <div className="mt-0.5 text-right text-[12.5px] text-muted tabular-nums">
            {t('draft.incVat', lang, { v: single ? money(totals.highWithTax, lang) : `${money(totals.lowWithTax, lang)}–${money(totals.highWithTax, lang)}` })}
            {totals.budget !== null && (
              <span className={totals.overBudget ? 'font-medium text-warn' : undefined}>
                {' · '}
                {totals.overBudget
                  ? t('totals.over', lang, { v: formatMoney(totals.high - totals.budget, lang) })
                  : t('totals.budget', lang, { v: formatMoney(totals.budget, lang) })}
              </span>
            )}
          </div>
        )}
        {draft.status !== 'submitted' && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onReview}
              disabled={building || count === 0}
              className="rounded-xl bg-navy px-10 py-3 text-[15px] font-bold text-white transition-[background-color,opacity] hover:bg-blue-hover disabled:opacity-40"
            >
              {t('draft.review', lang)}
            </button>
          </div>
        )}
      </footer>
    </Frame>
  );
}

function Row({
  line,
  lang,
  onChange,
  readOnly,
  flashKey,
  editing,
  enterDelay,
}: {
  line: DraftLine;
  lang: UiLang;
  onChange: (change: DraftChange) => void;
  readOnly: boolean;
  flashKey?: string;
  editing: boolean;
  enterDelay: number;
}) {
  const lineTotal = line.unitPrice === null ? null : line.unitPrice * line.packs;
  const status = STATUS.find(([tag]) => line.tags.includes(tag));
  const extras = line.tags.filter((tag) => !STATUS_TAGS.has(tag) && tag !== 'updated');
  const name = shortName(line.productName, 48);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 34, delay: enterDelay } }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="group relative overflow-hidden border-b border-line"
    >
      {flashKey && (
        <motion.div
          key={flashKey}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-flash"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: 'easeIn' }}
        />
      )}
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(84px,auto)] items-start gap-x-4 py-3.5 md:gap-x-8">
        <div className="min-w-0">
          <div className="text-[15.5px] font-medium leading-snug text-ink" title={line.productName}>{name}</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
            {status && <span className={status[2]}>{t(status[1], lang)}</span>}
            {extras.map((tag) => (
              <span key={tag} className="text-muted">{t(`tag.${tag}`, lang, { n: line.dietGuests ?? 0 })}</span>
            ))}
          </div>
          {line.substituteFor && (
            <div className="mt-1 text-[12.5px] text-muted">
              ← <span title={line.substituteFor.productName}>{shortName(line.substituteFor.productName)}</span> · {line.substituteFor.reason}
            </div>
          )}
        </div>

        {/* Quantity reads as plain text, like the design; − / + appear on hover or keyboard focus. */}
        <div className="flex items-center gap-0.5 pt-0.5">
          {!readOnly && (
            <Step label={t('row.less', lang)} disabled={line.packs <= 1} onClick={() => onChange({ kind: 'setPacks', lineId: line.id, packs: line.packs - 1 })}>
              <MinusIcon size={12} strokeWidth={2.4} />
            </Step>
          )}
          <span className="min-w-[56px] text-right text-[15.5px] font-bold tabular-nums text-ink" title={t('row.packs', lang, { n: line.packs, size: line.packDescription })}>
            {formatQty(line.quantity, line.unit, lang)}
          </span>
          {!readOnly && (
            <Step label={t('row.more', lang)} onClick={() => onChange({ kind: 'setPacks', lineId: line.id, packs: line.packs + 1 })}>
              <PlusIcon size={12} strokeWidth={2.4} />
            </Step>
          )}
        </div>

        <div className="flex items-center justify-end gap-1 pt-0.5">
          <span className="text-right text-[15.5px] font-bold tabular-nums text-navy">
            {lineTotal === null ? <span className="text-muted">—</span> : <CountUp value={lineTotal} format={(n) => money(n, lang)} />}
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange({ kind: 'removeLine', lineId: line.id })}
              aria-label={t('row.remove', lang, { name })}
              className="-mr-1 flex h-6 w-6 items-center justify-center rounded-full text-muted opacity-0 transition-opacity hover:bg-sky hover:text-navy focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <CloseIcon size={12} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      {editing && <LimeBar className="absolute inset-x-0 bottom-0" />}
      {line.history && (
        <div className="relative -mt-1 pb-3">
          <HistoryNote line={line} lang={lang} onChoose={(choice) => !readOnly && onChange({ kind: 'historyChoice', lineId: line.id, choice })} />
        </div>
      )}
    </motion.div>
  );
}

function Step({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-full text-muted opacity-0 transition-[opacity,background-color] hover:bg-sky hover:text-navy focus-visible:opacity-100 disabled:invisible group-hover:opacity-100 [@media(hover:none)]:opacity-100"
    >
      {children}
    </button>
  );
}
