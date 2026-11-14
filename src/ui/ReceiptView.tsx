'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { Receipt, UiLang } from '@/contracts';
import { formatDay, formatMoney, formatNumber, formatQty } from './format';
import { t } from './i18n';
import { ClockIcon, LeafIcon, PrintIcon } from './icons';

/** Order confirmation. The order number is "stamped" in; the decision log unfolds underneath. */
export function ReceiptView({
  receipt,
  onOpenAudit,
  audit,
  lang,
}: {
  receipt: Receipt;
  onOpenAudit: () => void;
  /** The rendered decision log, shown when present. */
  audit?: React.ReactNode;
  lang: UiLang;
}) {
  const money = (n: number) => formatMoney(n, lang, 2);

  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-[10px] border border-line bg-white shadow-card">
      <div className="aimo-scroll min-h-0 flex-1 overflow-y-auto">
        <header className="flex items-start justify-between gap-4 border-b-2 border-blue px-5 pb-4 pt-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22, delay: 0.1 }}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-ok text-white"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay: 0.25 }} />
                </svg>
              </motion.span>
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-navy">{t('receipt.sent', lang)}</h2>
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {receipt.eventName} · {t('receipt.delivery', lang, { d: formatDay(receipt.deliveryDate, lang) })} ·{' '}
              {t('sheet.guests', lang, { n: receipt.guests })}
            </p>
          </div>
          <motion.div
            initial={{ scale: 1.6, opacity: 0, rotate: -10 }}
            animate={{ scale: 1, opacity: 1, rotate: -3 }}
            transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.35 }}
            className="flex-none rounded-md border-[1.5px] border-navy px-2.5 py-1 text-center"
          >
            <div className="text-[13px] font-semibold tracking-[0.04em] text-navy tabular-nums">{receipt.orderId}</div>
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">{t('receipt.simulated', lang)}</div>
          </motion.div>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.3 }}
          className="mx-5 mt-4 flex items-center gap-2.5 rounded-lg bg-sky px-3 py-2.5 text-[13px] font-semibold text-navy"
        >
          <ClockIcon size={16} className="flex-none text-blue" />
          {t('receipt.saved', lang, { n: receipt.minutesSaved })}
        </motion.div>

        <ul className="mx-5 mt-3 divide-y divide-line text-[12.5px]">
          {receipt.lines.map((l) => (
            <li key={l.lineId} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate text-navy">{l.productName}</span>
              <span className="flex flex-none items-baseline gap-4 tabular-nums">
                <span className="text-ink-soft">{formatQty(l.quantity, l.unit, lang)}</span>
                <span className="w-20 text-right font-medium text-navy">{money(l.lineTotal)}</span>
              </span>
            </li>
          ))}
        </ul>

        <dl className="mx-5 mt-2 space-y-0.5 border-t border-navy/80 pt-2 text-[12.5px] tabular-nums">
          <Row label={t('receipt.subtotal', lang)} value={money(receipt.total)} />
          <Row label={t('receipt.vat', lang)} value={money(receipt.vat)} />
          <div className="flex items-baseline justify-between pt-0.5">
            <dt className="text-[13px] font-semibold text-navy">{t('receipt.total', lang)}</dt>
            <dd className="text-[18px] font-semibold text-navy">{money(receipt.totalWithTax)}</dd>
          </div>
        </dl>

        {receipt.co2Kg !== null && (
          <p className="mx-5 mt-2 flex items-center gap-1.5 text-[11.5px] text-muted">
            <LeafIcon size={13} className="text-ok" />
            {t('receipt.co2', lang, { v: formatNumber(receipt.co2Kg, lang, 0) })}
          </p>
        )}

        <AnimatePresence initial={false}>
          {audit && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mx-5 mt-4 border-t border-line pt-3">{audit}</div>
            </motion.section>
          )}
        </AnimatePresence>

        <div className="aimo-no-print flex gap-4 px-5 pb-4 pt-4 text-[12px] font-medium">
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-blue hover:underline">
            <PrintIcon size={14} />
            {t('receipt.print', lang)}
          </button>
          <button type="button" onClick={onOpenAudit} className="text-blue hover:underline">
            {audit ? t('receipt.hideLog', lang) : t('receipt.log', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-muted">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
