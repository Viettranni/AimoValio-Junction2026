import type { AvailabilityInfo, ISODate, PriceInfo } from '@/contracts';
import { getCached, getStale, setCached } from './cache';

const CUSTOMER = 'helsinki-juhlapalvelu';
const CHUNK_SIZE = 1000;
const TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 400;
const TERMINAL_UNKNOWN_AMOUNT = 999999;

export class ValioUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ValioUnavailableError';
  }
}

type Endpoint = 'price' | 'availability';

interface RawPrice {
  productId: string;
  error?: boolean;
  catalogPrice?: { value?: number; valueWithTax?: number; currency?: string };
  tax?: { taxRate?: number };
  comparisonPrice?: { value?: number };
  comparisonUnit?: string;
}

interface RawScheduleLine {
  salesBlock?: boolean;
  availableAmount?: number;
  availableDate?: string;
}

interface RawAvailability {
  productId: string;
  closingTime?: string;
  salesBlock?: boolean;
  logisticModel?: string;
  scheduleLines?: RawScheduleLine[];
}

function config() {
  const base = process.env.VALIO_API_BASE;
  const key = process.env.VALIO_API_KEY;
  if (!base || !key) throw new ValioUnavailableError('VALIO_API_BASE / VALIO_API_KEY not set');
  return { base: base.replace(/\/$/, ''), key };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw Object.assign(new Error(`Valio HTTP ${res.status}`), { retryable: res.status >= 500 });
  }
  return res.json();
}

async function request(url: string, init: RequestInit): Promise<unknown> {
  try {
    return await attempt(url, init);
  } catch (err) {
    // Network errors/timeouts have no `retryable` flag and are retried; 4xx are not.
    if ((err as { retryable?: boolean }).retryable === false) throw err;
    await sleep(RETRY_DELAY_MS);
    return attempt(url, init);
  }
}

async function post(endpoint: Endpoint, ids: string[], date: ISODate): Promise<RawPrice[] | RawAvailability[]> {
  const { base, key } = config();
  const body = await request(`${base}/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'X-API-Key': key,
      'content-type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (AimoPlanner)',
    },
    body: JSON.stringify({ customer: CUSTOMER, requestedDate: date, products: ids }),
  });
  return ((body as { products?: unknown[] }).products ?? []) as RawPrice[] | RawAvailability[];
}

function normalisePrice(raw: RawPrice, fetchedAt: string): PriceInfo {
  if (raw.error) return { productId: raw.productId, ok: false, currency: 'EUR', fetchedAt };
  return {
    productId: raw.productId,
    ok: true,
    price: raw.catalogPrice?.value,
    priceWithTax: raw.catalogPrice?.valueWithTax,
    taxRate: raw.tax?.taxRate,
    comparisonPrice: raw.comparisonPrice?.value,
    comparisonUnit: raw.comparisonUnit,
    currency: raw.catalogPrice?.currency ?? 'EUR',
    fetchedAt,
  };
}

function normaliseAvailability(raw: RawAvailability, fetchedAt: string): AvailabilityInfo {
  const lines = raw.scheduleLines ?? [];
  const line = lines[0];
  const salesBlock = raw.salesBlock ?? false;
  const amount =
    line?.availableAmount === undefined || line.availableAmount === TERMINAL_UNKNOWN_AMOUNT
      ? null
      : line.availableAmount;
  const logisticModel =
    raw.logisticModel === 'Stock' || raw.logisticModel === 'Terminal' ? raw.logisticModel : null;
  return {
    productId: raw.productId,
    deliverable: lines.length > 0 && !salesBlock && !line.salesBlock && (amount ?? 1) > 0,
    salesBlock,
    logisticModel,
    availableAmount: amount,
    availableDate: line?.availableDate ? line.availableDate.slice(0, 10) : null,
    closingTime: raw.closingTime ?? null,
    fetchedAt,
  };
}

async function fetchCached<T extends { productId: string }>(
  endpoint: Endpoint,
  ids: string[],
  date: ISODate,
  normalise: (raw: never, fetchedAt: string) => T,
): Promise<Map<string, T>> {
  const keyOf = (id: string) => `${endpoint}|${id}|${date}`;
  const result = new Map<string, T>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = getCached<T>(keyOf(id));
    if (hit) result.set(id, hit);
    else missing.push(id);
  }

  for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
    const chunk = missing.slice(i, i + CHUNK_SIZE);
    try {
      const fetchedAt = new Date().toISOString();
      const rows = await post(endpoint, chunk, date);
      for (const row of rows) {
        const info = (normalise as (r: unknown, f: string) => T)(row, fetchedAt);
        setCached(keyOf(info.productId), info);
        result.set(info.productId, info);
      }
    } catch (err) {
      // Serve stale values (keeping their old fetchedAt) if every id in the chunk has one.
      const stale = chunk.map((id) => getStale<T>(keyOf(id)));
      if (stale.some((s) => s === undefined)) {
        throw new ValioUnavailableError(`Valio ${endpoint} request failed`, { cause: err });
      }
      chunk.forEach((id, n) => result.set(id, stale[n] as T));
    }
  }
  return result;
}

export function getPrices(ids: string[], date: ISODate): Promise<Map<string, PriceInfo>> {
  return fetchCached<PriceInfo>('price', ids, date, normalisePrice);
}

export function getAvailability(ids: string[], date: ISODate): Promise<Map<string, AvailabilityInfo>> {
  return fetchCached<AvailabilityInfo>('availability', ids, date, normaliseAvailability);
}

export async function ping(): Promise<boolean> {
  try {
    const { base, key } = config();
    const res = await fetch(`${base}/api/ping`, {
      headers: { 'X-API-Key': key, 'User-Agent': 'Mozilla/5.0 (AimoPlanner)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
