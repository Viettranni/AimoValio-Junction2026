'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { DraftLine, UiLang } from '@/contracts';
import { formatQty, formatQtyDelta } from './format';
import { t } from './i18n';
import { HistoryIcon } from './icons';

/** "Last time" note, style B: a soft warm glow inside the row. Collapses to one muted line once chosen. */
export function HistoryNote({
  line,
  onChoose,
  lang,
}: {
  line: DraftLine;
  onChoose: (choice: 'history' | 'suggested') => void;
  lang: UiLang;
}) {
  const history = line.history;
  if (!history) return null;
  const { adjustment, choice } = history;
  const size = line.packs > 0 ? line.quantity / line.packs : 0;
  const historyQty = formatQty(history.historyPacks * size, line.unit, lang);
  const suggestedQty = formatQty(history.suggestedPacks * size, line.unit, lang);
  const last = adjustment.last;

  // After rounding to packs history can land on exactly the suggested amount; then there is nothing to choose.
  if (history.historyPacks === history.suggestedPacks) {
    return (
      <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-muted tabular-nums" title={t('history.basis', lang, { n: adjustment.sampleSize })}>
        <HistoryIcon size={12} className="flex-none" />
        {t('history.agrees', lang, { q: suggestedQty })}
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {choice === 'pending' ? (
        <motion.div
          key="pending"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.22 }}
          className="overflow-hidden"
        >
          <div
            className="aimo-glow flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[11.5px] leading-4 text-ink-soft"
            title={t('history.basis', lang, { n: adjustment.sampleSize })}
          >
            <HistoryIcon size={14} className="flex-none text-warm-icon" />
            <span className="min-w-0 flex-1 tabular-nums">
              <b className="font-semibold text-navy">{t('history.lastTime', lang)}</b>{' '}
              {last?.guests ? `${t('history.event', lang, { event: last.eventName, n: last.guests })} ` : ''}
              {last && last.leftoverQty < 0
                ? t('history.short', lang, { q: formatQty(-last.leftoverQty, adjustment.unit, lang) })
                : t('history.left', lang, { q: formatQty(last?.leftoverQty ?? 0, adjustment.unit, lang) })}{' '}
              {t('history.suggests', lang)} <b className="font-semibold text-navy">{historyQty}</b>.
            </span>
            <button
              type="button"
              onClick={() => onChoose('history')}
              className="flex-none rounded-full border border-warm-border bg-white px-2.5 py-[3px] text-[11px] font-semibold text-warm-ink shadow-sm transition-colors hover:border-warm-icon tabular-nums"
            >
              {t('history.use', lang, { q: historyQty })}
            </button>
            <button
              type="button"
              onClick={() => onChoose('suggested')}
              className="flex-none rounded-full px-1.5 py-[3px] text-[11px] font-semibold text-warm-ink/70 transition-colors hover:text-warm-ink"
            >
              {t('history.keep', lang)}
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="chosen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-1.5 px-0.5 text-[11px] text-muted tabular-nums"
        >
          <HistoryIcon size={12} className="flex-none" />
          <span>
            {choice === 'history'
              ? t('history.applied', lang, {
                  d: formatQtyDelta((history.historyPacks - history.suggestedPacks) * size, line.unit, lang),
                })
              : t('history.kept', lang, { q: suggestedQty })}
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => onChoose(choice === 'history' ? 'suggested' : 'history')}
            className="font-medium text-blue hover:underline"
          >
            {choice === 'history' ? t('history.undo', lang) : t('history.use', lang, { q: historyQty })}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
