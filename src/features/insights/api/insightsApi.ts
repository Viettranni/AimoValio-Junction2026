// Model: HTTP client for the insights routes.
import type { Answer, Clarify } from '@/insights/analyst';
import type { StoryCard } from '@/insights/views';

export type Source = 'demo' | 'live';
export interface DirectoryEntry { id: string; name: string; sites: Array<{ id: string; name: string }> }
export interface Directory { demo: DirectoryEntry[]; live: Array<{ id: string; name: string }> }
export interface Wrapped { title: string; cards: StoryCard[] }
export interface ExploreFilters { siteId?: string; period?: string; category?: string; event_type?: string }
export type AskResult = Answer | Clarify;

/** The response body, or an Error with the server's message. */
export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const msg = typeof body === 'object' && body !== null && 'message' in body ? String(body.message)
      : typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const data: T = await res.json();
  return data;
}

export async function fetchDirectory(): Promise<Directory> {
  return json<Directory>(await fetch('/api/insights/buyers', { cache: 'no-store' }));
}

export async function fetchWrapped({ buyerId, siteId, source }: { buyerId: string; siteId: string; source: Source }): Promise<Wrapped> {
  const qs = new URLSearchParams({ buyerId, source, ...(siteId ? { siteId } : {}) });
  return json<Wrapped>(await fetch(`/api/insights/wrapped?${qs}`, { cache: 'no-store' }));
}

export async function ask({ buyerId, prompt, filters, source }: { buyerId: string; prompt: string; filters: ExploreFilters; source: Source }): Promise<AskResult> {
  const { siteId, ...pageFilters } = filters;
  const res = await fetch('/api/insights/ask', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buyerId, prompt, filters: pageFilters, siteId: siteId || null, source }),
  });
  return json<AskResult>(res);
}
