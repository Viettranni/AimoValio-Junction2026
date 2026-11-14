'use client';

import { motion } from 'motion/react';
import type { UiLang } from '@/contracts';
import { DELIVERY_STATES, type DeliveryStatus } from '@/gateway/delivery';
import { formatDateTime, formatDay, formatTime } from './format';
import { t } from './i18n';
import { CheckIcon } from './icons';
import { deliveryStateLabel } from './offerCard';

const isoDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Compact horizontal delivery timeline: five steps, the current one highlighted, the ETA window and the cut-off.
 * Fixed height (a placeholder of the same size while loading), so the receipt never shifts.
 */
export function DeliveryTimeline({ delivery, lang }: { delivery: DeliveryStatus | null | undefined; lang: UiLang }) {
  const current = delivery ? DELIVERY_STATES.indexOf(delivery.state) : -1;
  const progress = current <= 0 ? 0 : current / (DELIVERY_STATES.length - 1);
  const delivered = delivery?.state === 'delivered';
  const supplier = delivery?.supplier;

  return (
    <section className="mx-5 mt-3 rounded-lg border border-line px-3 pb-2.5 pt-2" aria-label={t('delivery.title', lang)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-[13px] font-bold uppercase tracking-[0.06em] text-navy">{t('delivery.title', lang)}</h3>
        <span className="truncate text-[11.5px] text-ink-soft tabular-nums">
          {delivery
            ? delivered
              ? t('delivery.deliveredAt', lang, { day: formatDay(isoDay(delivery.eta.to), lang), time: formatTime(delivery.eta.to, lang) })
              : t('delivery.eta', lang, { day: formatDay(isoDay(delivery.eta.from), lang), from: formatTime(delivery.eta.from, lang), to: formatTime(delivery.eta.to, lang) })
            : ' '}
        </span>
      </div>

      <ol className="relative mt-2.5 grid grid-cols-5">
        {/* Track behind the dots, from the first to the last dot's centre. */}
        <span aria-hidden className="absolute left-[10%] right-[10%] top-[7px] h-[2px] rounded bg-line" />
        <motion.span
          aria-hidden
          className="absolute left-[10%] top-[7px] h-[2px] rounded bg-blue"
          initial={false}
          animate={{ width: `${progress * 80}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        />
        {DELIVERY_STATES.map((state, i) => {
          const done = delivery !== null && delivery !== undefined && i < current;
          const now = i === current;
          return (
            <li key={state} className="relative flex flex-col items-center text-center" aria-current={now ? 'step' : undefined}>
              <motion.span
                initial={false}
                animate={{ scale: now ? 1.15 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className={`relative z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 transition-colors duration-300 ${
                  now ? (delivered ? 'border-ok bg-ok text-white' : 'border-blue bg-lime') : done ? 'border-blue bg-blue text-white' : 'border-line bg-white'
                }`}
              >
                {(done || (now && delivered)) && <CheckIcon size={9} strokeWidth={3.4} />}
              </motion.span>
              <span className={`mt-1 text-[10.5px] leading-tight transition-colors duration-300 ${now ? 'font-semibold text-navy' : done ? 'text-ink-soft' : 'text-muted'}`}>
                {deliveryStateLabel(state, lang)}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-2 flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums">
        {delivery?.cutoff && (
          <span className={delivery.cutoffPassed ? 'text-ok' : 'text-muted'}>
            {t(delivery.cutoffPassed ? 'delivery.orderByPassed' : 'delivery.orderBy', lang, { time: formatDateTime(delivery.cutoff, lang) })}
          </span>
        )}
        {supplier && (
          <span className="text-muted">
            {t('delivery.supplier', lang, { n: supplier.lineIds.length })}:{' '}
            <span className={supplier.state !== 'waiting' ? 'text-ink-soft' : ''}>{supplier.state !== 'waiting' && '✓ '}{t('delivery.supplierOrdered', lang)}</span>
            {' → '}
            <span className={supplier.state === 'arrived' ? 'text-ink-soft' : ''}>{supplier.state === 'arrived' && '✓ '}{t('delivery.supplierArrived', lang)}</span>
          </span>
        )}
        {delivery?.lateRisk && <span className="rounded-full bg-warn/10 px-2 py-0.5 font-medium text-warn">{t('delivery.lateRisk', lang)}</span>}
        <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-muted">{t('delivery.simulated', lang)}</span>
      </div>
    </section>
  );
}
