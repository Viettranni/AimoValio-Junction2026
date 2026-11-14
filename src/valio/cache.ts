const TTL_MS = 10 * 60 * 1000;

interface Entry {
  value: unknown;
  storedAt: number;
}

const store = new Map<string, Entry>();
let now: () => number = Date.now;

/** Inject a clock (tests). Pass nothing to restore the real one. */
export function setClock(clock: () => number = Date.now): void {
  now = clock;
}

export function clearCache(): void {
  store.clear();
}

export function setCached<T>(key: string, value: T): void {
  store.set(key, { value, storedAt: now() });
}

/** Fresh value (younger than 10 min), or undefined. */
export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry || now() - entry.storedAt >= TTL_MS) return undefined;
  return entry.value as T;
}

/** Last known value regardless of age, used as a fallback when Valio is down. */
export function getStale<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}
