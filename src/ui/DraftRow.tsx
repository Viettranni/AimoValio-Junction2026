'use client';

import { motion } from 'motion/react';
import type { DraftChange, DraftLine, LineTag, UiLang } from '@/contracts';
import { CountUp } from './CountUp';
import { formatMoney, formatQty } from './format';
import { t } from './i18n';
import { CloseIcon, MinusIcon, PlusIcon } from './icons';
import { HistoryNote } from './HistoryNote';
import { shortName } from './productName';
import { LimeBar } from './ShelfShuffle';

const TAG_TONE: Partial<Record<LineTag, string>> = {
  may_deliver_short: 'bg-warn/10 text-warn',
  allergens_unknown: 'bg-danger/10 text-danger',
  unavailable: 'bg-danger/10 text-danger',
};

export const SHEET_COLUMNS = 'grid grid-cols-[minmax(0,1fr)_auto_76px_22px] items-center gap-x-3';

export function DraftRow({
  line,
  flashKey,
  onChange,
  lang,
  readOnly,
  problem,
  editing,
  enterDelay = 0,
}: {
  line: DraftLine;
  /** A new value replays the soft-blue "changed" flash. */
  flashKey?: string;
  onChange: (change: DraftChange) => void;
  lang: UiLang;
  readOnly?: boolean;
  /** Why the last approval rejected this line. */
  problem?: string;
  /** An edit of this line is in flight: a thin lime bar runs along its foot. */
  editing?: boolean;
  /** Seconds to wait before dropping in (rows replacing skeletons arrive one after another). */
  enterDelay?: number;
}) {
  const size = line.packs > 0 ? line.quantity / line.packs : 0;
  const lineTotal = line.unitPrice === null ? null : line.unitPrice * line.packs;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -10 }}
      // The delay belongs to the drop-in only; layout moves later must not wait for it.
      animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 34, delay: enterDelay } }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="group relative overflow-hidden border-b border-line last:border-b-0"
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
      <div className={`relative ${SHEET_COLUMNS} px-4 py-2.5`}>
        <div className="min-w-0">
          <div className="text-[13px] font-medium leading-[18px] text-navy" title={line.productName}>{shortName(line.productName)}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {line.tags.map((tag) => (
              <span
                key={tag}
                className={`rounded px-1.5 py-px text-[10px] font-medium leading-[15px] ${TAG_TONE[tag] ?? 'bg-sky text-blue'}`}
              >
                {t(`tag.${tag}`, lang, { n: line.dietGuests ?? 0 })}
              </span>
            ))}
          </div>
          {problem && <div className="mt-1 text-[11.5px] font-medium text-warn">{problem}</div>}
          {line.substituteFor && (
            <div className="mt-1 text-[11px] text-muted">
              ← <span title={line.substituteFor.productName}>{shortName(line.substituteFor.productName)}</span> · {line.substituteFor.reason}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <div
            aria-disabled={readOnly || undefined}
            className={`inline-flex items-center rounded-md border transition-[opacity,background-color] duration-200 ${
              readOnly ? 'border-line/70 bg-ice opacity-60' : 'border-line bg-white'
            }`}
          >
            <StepButton label={t('row.less', lang)} disabled={readOnly || line.packs <= 1} onClick={() => onChange({ kind: 'setPacks', lineId: line.id, packs: line.packs - 1 })}>
              <MinusIcon size={12} strokeWidth={2.4} />
            </StepButton>
            <span className="min-w-[58px] px-1 text-center text-[12.5px] font-medium tabular-nums text-navy">
              {formatQty(line.quantity, line.unit, lang)}
            </span>
            <StepButton label={t('row.more', lang)} disabled={readOnly} onClick={() => onChange({ kind: 'setPacks', lineId: line.id, packs: line.packs + 1 })}>
              <PlusIcon size={12} strokeWidth={2.4} />
            </StepButton>
          </div>
          <span className="text-[10.5px] text-muted tabular-nums">
            {t('row.packs', lang, { n: line.packs, size: formatQty(size, line.unit, lang) })}
          </span>
        </div>

        <div className="text-right text-[13px] font-semibold text-navy">
          {lineTotal === null ? <span className="text-muted">—</span> : <CountUp value={lineTotal} format={(n) => formatMoney(n, lang)} />}
        </div>

        {readOnly ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={() => onChange({ kind: 'removeLine', lineId: line.id })}
            aria-label={t('row.remove', lang, { name: shortName(line.productName) })}
            className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-muted opacity-35 transition-opacity hover:bg-sky hover:text-navy focus-visible:opacity-100 group-hover:opacity-100"
          >
            <CloseIcon size={12} strokeWidth={2.4} />
          </button>
        )}
      </div>
      {editing && <LimeBar className="absolute inset-x-0 bottom-0" />}
      {line.history && (
        <div className="relative px-4 pb-2.5 -mt-0.5">
          <HistoryNote
            line={line}
            lang={lang}
            onChoose={(choice) => !readOnly && onChange({ kind: 'historyChoice', lineId: line.id, choice })}
          />
        </div>
      )}
    </motion.div>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center text-ink-soft transition-colors hover:bg-ice hover:text-blue disabled:text-line disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
