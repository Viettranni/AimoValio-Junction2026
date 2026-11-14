import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache, setClock } from './cache';
import { getAvailability, getPrices, ping, ValioUnavailableError } from './client';

const sample = (name: string) => JSON.parse(readFileSync(`docs/valio/${name}`, 'utf8'));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.VALIO_API_BASE = 'https://valio.test';
  process.env.VALIO_API_KEY = 'secret';
  clearCache();
  setClock();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getPrices', () => {
  it('parses the fixture and flags unknown products', async () => {
    fetchMock.mockResolvedValue(json(sample('sample-price.json')));
    const prices = await getPrices(['460000', '460001', '999999999'], '2026-12-06');
    expect(prices.get('460000')).toMatchObject({
      ok: true, price: 1.96, priceWithTax: 2.22, taxRate: 13.5,
      comparisonPrice: 4.9, comparisonUnit: 'KG', currency: 'EUR',
    });
    expect(prices.get('999999999')?.ok).toBe(false);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://valio.test/api/price');
    expect(init.headers).toMatchObject({
      'X-API-Key': 'secret',
      'content-type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (AimoPlanner)',
    });
    expect(JSON.parse(init.body)).toEqual({
      customer: 'helsinki-juhlapalvelu',
      requestedDate: '2026-12-06',
      products: ['460000', '460001', '999999999'],
    });
  });

  it('dedupes ids and chunks 2500 ids into 3 calls', async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const products = JSON.parse(init.body as string).products as string[];
      return json({ products: products.map((productId) => ({ productId, error: true })) });
    });
    const ids = Array.from({ length: 2500 }, (_, i) => String(i));
    await getPrices([...ids, ...ids], '2026-12-06');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('serves the second call from cache', async () => {
    fetchMock.mockResolvedValue(json(sample('sample-price.json')));
    await getPrices(['460000'], '2026-12-06');
    await getPrices(['460000'], '2026-12-06');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once after a 500', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(json(sample('sample-price.json')));
    const prices = await getPrices(['460000'], '2026-12-06');
    expect(prices.get('460000')?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws ValioUnavailableError when failing without a cache', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    await expect(getPrices(['460000'], '2026-12-06')).rejects.toBeInstanceOf(ValioUnavailableError);
  });

  it('returns the stale value with its old fetchedAt on failure', async () => {
    let t = Date.parse('2026-11-14T10:00:00Z');
    setClock(() => t);
    fetchMock.mockResolvedValueOnce(json(sample('sample-price.json')));
    const first = (await getPrices(['460000'], '2026-12-06')).get('460000');
    t += 11 * 60 * 1000;
    fetchMock.mockRejectedValue(new Error('down'));
    const second = (await getPrices(['460000'], '2026-12-06')).get('460000');
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('getAvailability', () => {
  it('normalises fixture lines and unknown ids are not deliverable', async () => {
    fetchMock.mockResolvedValue(json(sample('sample-availability.json')));
    const res = await getAvailability(['460000', '999999999'], '2026-12-06');
    expect(res.get('460000')).toMatchObject({
      deliverable: true, salesBlock: false, logisticModel: 'Stock',
      availableAmount: 48, availableDate: '2026-11-16',
    });
    const unknown = res.get('999999999');
    if (unknown) expect(unknown.deliverable).toBe(false);
  });

  it('maps terminal 999999 to null and a missing schedule to not deliverable', async () => {
    fetchMock.mockResolvedValue(
      json({
        products: [
          { productId: 'a', logisticModel: 'Terminal', salesBlock: false,
            scheduleLines: [{ availableAmount: 999999, availableDate: '2026-12-01T00:00:00+0200', salesBlock: false }] },
          { productId: 'b', logisticModel: 'Stock', salesBlock: false, scheduleLines: [] },
        ],
      }),
    );
    const res = await getAvailability(['a', 'b'], '2026-12-06');
    expect(res.get('a')).toMatchObject({ deliverable: true, availableAmount: null, availableDate: '2026-12-01' });
    expect(res.get('b')?.deliverable).toBe(false);
  });
});

describe('ping', () => {
  it('is true on 200 and false on failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok'));
    expect(await ping()).toBe(true);
    fetchMock.mockRejectedValueOnce(new Error('x'));
    expect(await ping()).toBe(false);
  });
});
