'use client';

import { motion } from 'motion/react';
import type { OrderSummary, UiLang } from '@/contracts';
import { formatDay, formatMoney } from './format';
import { t } from './i18n';
import { ArrowLeftIcon } from './icons';

function leftoverText(o: OrderSummary, lang: UiLang): { text: string; tone: string } {
  if (!o.checkInDone || o.leftoverRatio === null) return { text: t('orders.pending', lang), tone: 'text-muted' };
  const p = Math.round(Math.abs(o.leftoverRatio) * 100);
  if (p === 0) return { text: t('orders.exact', lang), tone: 'text-ok' };
  return o.leftoverRatio > 0
    ? { text: t('orders.left', lang, { p }), tone: 'text-warm-ink' }
    : { text: t('orders.short', lang, { p }), tone: 'text-warn' };
}

/** A plain list of past orders. No dashboards. */
export function MyOrders({
  orders,
  onOpen,
  onBack,
  lang,
}: {
  orders: OrderSummary[];
  onOpen: (orderId: string) => void;
  onBack?: () => void;
  lang: UiLang;
}) {
  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-[10px] border border-line bg-white shadow-card">
      <header className="flex items-baseline justify-between gap-3 border-b-2 border-blue px-4 pb-3 pt-3.5">
        <h2 className="font-display text-[19px] font-bold uppercase leading-none tracking-[0.02em] text-navy">{t('orders.title', lang)}</h2>
        {onBack && (
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[12px] font-medium text-blue hover:underline">
            <ArrowLeftIcon size={13} />
            {t('orders.back', lang)}
          </button>
        )}
      </header>
      <ul className="aimo-scroll min-h-0 flex-1 overflow-y-auto">
        {orders.length === 0 && <li className="px-4 py-6 text-center text-[12.5px] text-muted">{t('orders.empty', lang)}</li>}
        {orders.map((o, i) => {
          const left = leftoverText(o, lang);
          return (
            <motion.li
              key={o.orderId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="border-b border-line last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onOpen(o.orderId)}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-ice"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-navy">{o.eventName}</span>
                  <span className="block text-[11.5px] text-muted tabular-nums">
                    {formatDay(o.eventDate, lang)} · {t('sheet.guests', lang, { n: o.guests })} · {o.orderId}
                  </span>
                </span>
                <span className="flex-none text-right tabular-nums">
                  <span className="block text-[13px] font-semibold text-navy">{formatMoney(o.total, lang)}</span>
                  <span className={`block text-[11px] ${left.tone}`}>{left.text}</span>
                </span>
              </button>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
