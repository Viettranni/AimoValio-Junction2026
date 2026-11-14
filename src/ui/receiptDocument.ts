import type { Receipt, UiLang } from '@/contracts';
import { customerDisplayName } from './fixtures';
import { formatMoney, formatNumber, formatQty } from './format';
import { localeFor, t } from './i18n';
import { displayName } from './productName';

/**
 * The downloadable receipt: a standalone, printable HTML page with only the order header, the ordered lines
 * and the totals. Nothing from the chat, decision log, delivery timeline or check-in goes in it.
 */
export function receiptDocument(receipt: Receipt, lang: UiLang): string {
  const money = (n: number) => formatMoney(n, lang, 2);
  const title = `${t('receipt.doc.title', lang)} ${receipt.orderId}`;

  const meta: Array<[string, string]> = [
    [t('receipt.doc.order', lang), receipt.orderId],
    [t('receipt.doc.placed', lang), formatStamp(receipt.submittedAt, lang)],
    [t('receipt.doc.delivery', lang), receipt.deliveryDate ? formatLongDay(receipt.deliveryDate, lang) : '–'],
    [t('receipt.doc.event', lang), receipt.guests > 0 ? `${receipt.eventName} · ${t('sheet.guests', lang, { n: receipt.guests })}` : receipt.eventName],
    [t('receipt.doc.customer', lang), customerDisplayName(receipt.customerId)],
  ];

  const rows = receipt.lines
    .map((l) => {
      const packSize = l.packs > 0 ? l.quantity / l.packs : l.quantity;
      return `<tr>
        <td class="name">${esc(displayName(l.productName))}</td>
        <td>${esc(formatQty(packSize, l.unit, lang))}</td>
        <td class="num">${esc(l.packs === 1 ? t('receipt.doc.packs.one', lang) : t('receipt.doc.packs', lang, { n: formatNumber(l.packs, lang) }))}<span class="sub">${esc(formatQty(l.quantity, l.unit, lang))}</span></td>
        <td class="num">${esc(money(l.unitPrice))}</td>
        <td class="num strong">${esc(money(l.lineTotal))}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #23282d; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 24px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid #005670; padding-bottom: 14px; }
  .brand { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #5b6b70; }
  h1 { margin: 2px 0 0; font-size: 24px; color: #005670; letter-spacing: -.01em; }
  .id { font-size: 18px; font-weight: 700; color: #005670; font-variant-numeric: tabular-nums; }
  dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 20px; margin: 18px 0 24px; }
  dl.meta dt { color: #5b6b70; }
  dl.meta dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #5b6b70; padding: 8px 8px; border-bottom: 1px solid #005670; }
  td { padding: 9px 8px; border-bottom: 1px solid #d3e2e6; vertical-align: top; }
  th:first-child, td:first-child { padding-left: 0; }
  th:last-child, td:last-child { padding-right: 0; }
  .num { text-align: right; white-space: nowrap; }
  .name { width: 44%; }
  .sub { display: block; font-size: 12px; color: #5b6b70; }
  .strong { font-weight: 600; }
  tr { page-break-inside: avoid; }
  .totals { margin: 16px 0 0 auto; width: 100%; max-width: 300px; font-variant-numeric: tabular-nums; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; color: #5b6b70; }
  .totals .grand { margin-top: 4px; padding-top: 8px; border-top: 1px solid #005670; color: #005670; font-size: 17px; font-weight: 700; }
  footer { margin-top: 28px; font-size: 12px; color: #5b6b70; }
  footer p { margin: 2px 0; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="brand">Valio Aimo</div>
      <h1>${esc(t('receipt.doc.title', lang))}</h1>
    </div>
    <div class="id">${esc(receipt.orderId)}</div>
  </header>
  <dl class="meta">
    ${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('\n    ')}
  </dl>
  <table>
    <thead>
      <tr>
        <th>${esc(t('receipt.doc.product', lang))}</th>
        <th>${esc(t('receipt.doc.pack', lang))}</th>
        <th class="num">${esc(t('receipt.doc.qty', lang))}</th>
        <th class="num">${esc(t('receipt.doc.unitPrice', lang))}</th>
        <th class="num">${esc(t('receipt.doc.lineTotal', lang))}</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <section class="totals">
    <div><span>${esc(t('receipt.subtotal', lang))}</span><span>${esc(money(receipt.total))}</span></div>
    <div><span>${esc(t('receipt.vat', lang))}</span><span>${esc(money(receipt.vat))}</span></div>
    <div class="grand"><span>${esc(t('receipt.total', lang))}</span><span>${esc(money(receipt.totalWithTax))}</span></div>
  </section>
  <footer>
    <p>${esc(t('receipt.doc.pricesNote', lang))}</p>
    ${receipt.simulated ? `<p>${esc(t('receipt.doc.simulated', lang))}</p>` : ''}
  </footer>
</main>
</body>
</html>
`;
}

export function receiptFileName(receipt: Receipt): string {
  return `aimo-receipt-${receipt.orderId.replace(/[^A-Za-z0-9-]+/g, '-')}.html`;
}

/** Saves the receipt document as a file (browser only). */
export function downloadReceipt(receipt: Receipt, lang: UiLang): void {
  const blob = new Blob([receiptDocument(receipt, lang)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = receiptFileName(receipt);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** "Sunday 6 December 2026", read as a local calendar date. */
function formatLongDay(date: string, lang: UiLang): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Intl.DateTimeFormat(localeFor(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
}

function formatStamp(iso: string, lang: UiLang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(localeFor(lang), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
