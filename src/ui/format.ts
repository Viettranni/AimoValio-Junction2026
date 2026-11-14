import type { ISODate, MeasureUnit, UiLang } from '@/contracts';
import { localeFor, t } from './i18n';

export function formatMoney(value: number, lang: UiLang, decimals = 0): string {
  return new Intl.NumberFormat(localeFor(lang), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatNumber(value: number, lang: UiLang, maxDecimals = 1): string {
  return new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: maxDecimals }).format(value);
}

export function formatQty(value: number, unit: MeasureUnit, lang: UiLang): string {
  return `${formatNumber(value, lang)} ${t(`unit.${unit}`, lang)}`;
}

/** Signed quantity, e.g. "+4.4 kg" / "−5 kg" (true minus sign). */
export function formatQtyDelta(value: number, unit: MeasureUnit, lang: UiLang): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatQty(Math.abs(value), unit, lang)}`;
}

/** "Sat 6 Dec" style, read as a local calendar date. */
export function formatDay(date: ISODate, lang: UiLang): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(y, m - 1, d),
  );
}

export function formatDateTime(iso: string, lang: UiLang): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatTime(iso: string, lang: UiLang): string {
  return new Intl.DateTimeFormat(localeFor(lang), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
