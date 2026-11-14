'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { UiLang } from '@/contracts';
import { mixGroups, productsFromNames, termsKey, throttleWait, type ShelfProduct } from './shelf';

const SAMPLE_SIZE = 24;
/** One request per term set for the life of the page; failures are retried on the next term set only. */
const requests = new Map<string, Promise<ShelfProduct[]>>();

function fetchSample(terms: string[], lang: UiLang): Promise<ShelfProduct[]> {
  const key = `${lang}:${termsKey(terms)}`;
  let request = requests.get(key);
  if (!request) {
    const params = new URLSearchParams({ q: terms.join(','), n: String(SAMPLE_SIZE), lang });
    request = fetch(`/api/catalog/sample?${params}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ products: ShelfProduct[] }>) : { products: [] }))
      .then((json) => json.products ?? [])
      .catch(() => []);
    requests.set(key, request);
  }
  return request;
}

/**
 * Catalogue products relevant to the conversation, for the loaders. Live mode asks the sample endpoint
 * once per term set (and only once `enabled`, i.e. the assistant has started working); fixture mode
 * rolls the scripted demo's product names and never fetches.
 */
export function useProductSample({
  terms,
  lang,
  enabled,
  fixtureNames,
}: {
  terms: string[];
  lang: UiLang;
  enabled: boolean;
  fixtureNames?: string[];
}): ShelfProduct[] {
  const key = `${lang}:${termsKey(terms)}`;
  const [loaded, setLoaded] = useState<{ key: string; products: ShelfProduct[] } | null>(null);
  const fixture = fixtureNames !== undefined;

  useEffect(() => {
    if (fixture || !enabled) return;
    let live = true;
    fetchSample(terms, lang).then((products) => live && products.length > 0 && setLoaded({ key, products }));
    return () => {
      live = false;
    };
    // `terms` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, fixture]);

  if (fixture) return fixtureProducts(fixtureNames);
  // Until the new term set arrives the previous products keep rolling, so the card never empties.
  return loaded?.products ?? EMPTY;
}

const EMPTY: ShelfProduct[] = [];
let fixtureCache: { names: string[]; products: ShelfProduct[] } | null = null;
function fixtureProducts(names: string[]): ShelfProduct[] {
  if (fixtureCache?.names !== names) fixtureCache = { names, products: mixGroups(productsFromNames(names)) };
  return fixtureCache.products;
}

// ───────────── Shared loader state ─────────────

export interface ShelfState {
  products: ShelfProduct[];
  /** The assistant is answering: loaders for a step that never finished (a failed turn) stay hidden. */
  working: boolean;
  /** False while the widget is minimised or the tab is hidden: rolls stop ticking. */
  running: boolean;
  lang: UiLang;
}

export const ShelfContext = createContext<ShelfState>({ products: EMPTY, working: false, running: false, lang: 'en' });
export const useShelf = () => useContext(ShelfContext);

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};

/** True while the page is visible (background tabs stop the loaders). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => true);
}

/** A counter that advances every `ms` while `running`: drives every roll from one clock per component. */
export function useTick(ms: number, running: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms, running]);
  return tick;
}

/** `value`, changing at most once per `minMs` (the latest value wins when the window opens). */
export function useThrottled<T>(value: T, minMs: number): T {
  const [shown, setShown] = useState<{ value: T; at: number | null }>({ value, at: null });
  useEffect(() => {
    if (Object.is(value, shown.value)) return;
    const id = setTimeout(() => setShown({ value, at: Date.now() }), throttleWait(shown.at, Date.now(), minMs));
    return () => clearTimeout(id);
  }, [value, shown, minMs]);
  return shown.value;
}
