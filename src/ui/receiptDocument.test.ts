import { describe, expect, it } from 'vitest';
import type { Receipt } from '@/contracts';
import { receiptDocument, receiptFileName } from './receiptDocument';

const receipt: Receipt = {
  orderId: 'VA-2026-04817',
  simulated: true,
  customerId: 'helsinki-juhlapalvelu',
  eventName: 'Wedding <Smith & Co>',
  eventType: 'wedding',
  deliveryDate: '2026-12-06',
  guests: 300,
  lines: [
    {
      lineId: 'l1', productId: 'p1', productName: 'KARINIEMEN CHICKEN BREAST FILLET FI', packs: 12, quantity: 52.8, unit: 'kg',
      unitPrice: 43.1, unitPriceWithTax: 48.92, lineTotal: 517.2, lineTotalWithTax: 587.02, logisticModel: 'Stock',
    },
    {
      lineId: 'l2', productId: 'p2', productName: 'Jasmine rice', packs: 5, quantity: 25, unit: 'kg',
      unitPrice: 12, unitPriceWithTax: 13.62, lineTotal: 60, lineTotalWithTax: 68.1,
    },
  ],
  total: 577.2, totalWithTax: 655.12, vat: 77.92,
  cutoff: '2026-12-04T12:00:00.000Z',
  co2Kg: 321,
  minutesSaved: 42,
  submittedAt: '2026-11-14T10:30:00.000Z',
};

describe('receipt download document', () => {
  const html = receiptDocument(receipt, 'en');

  it('is a standalone HTML page titled with the order id', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Order receipt VA-2026-04817</title>');
    expect(receiptFileName(receipt)).toBe('aimo-receipt-VA-2026-04817.html');
  });

  it('carries the order header, every line and the totals', () => {
    expect(html).toContain('Delivery');
    expect(html).toContain('2026');
    expect(html).toContain('300 guests');
    expect(html).toContain('Kariniemen chicken breast fillet'); // display name, country code dropped
    expect(html).toContain('Jasmine rice');
    expect(html).toContain('4.4 kg'); // pack size
    expect(html).toContain('12 packs');
    const single = receiptDocument({ ...receipt, lines: [{ ...receipt.lines[1], packs: 1, quantity: 5 }] }, 'en');
    expect(single).toContain('1 pack<');
    expect(html).toContain('52.8 kg');
    expect(html).toContain('€43.10'); // unit price
    expect(html).toContain('€517.20'); // line total
    expect(html).toContain('€577.20');
    expect(html).toContain('€77.92');
    expect(html).toContain('€655.12');
  });

  it('leaves out everything that is not the receipt or the list', () => {
    for (const absent of ['CO₂', 'Saved', 'min vs', 'Decision log', 'Stock', '<script', 'cutoff', 'Order by']) {
      expect(html).not.toContain(absent);
    }
  });

  it('escapes text from the order', () => {
    expect(html).toContain('Wedding &lt;Smith &amp; Co&gt;');
    expect(html).not.toContain('<Smith');
  });

  it('follows the buyer’s language', () => {
    const fi = receiptDocument(receipt, 'fi');
    expect(fi).toContain('Tilauskuitti');
    expect(fi).toContain('<html lang="fi">');
  });
});
