'use client';

// ViewModel for the Insights page: data source (demo/live), organisation, "Your year" story and Explore.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api/insightsApi';
import type { AskResult, Directory, ExploreFilters, Source, Wrapped } from '../api/insightsApi';

export const STARTERS = ['Spend by month', 'Top 10 products by spend, rest as other', 'Waste % by kitchen compared to previous period, last 3 months',
  'Category mix per kitchen', 'Carbon footprint by category, share', 'Orders by weekday and kitchen as a heatmap', 'Spend and waste % by product'];

export type Tab = 'year' | 'explore';
export interface ClarifyState { answers: Record<number, string>; custom: number | null }
type AskState = AskResult | { error: string } | null;

const DEFAULT_BUYER = 'BUY-POHJOLA';

export function useInsights({ initialBuyerId, initialSiteId }: { initialBuyerId?: string; initialSiteId?: string }) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [source, setSourceState] = useState<Source>('demo');
  const [demoBuyerId, setDemoBuyerId] = useState(initialBuyerId ?? DEFAULT_BUYER);
  const [tab, setTab] = useState<Tab>('year');
  const [yearSite, setYearSite] = useState(initialSiteId ?? '');
  const [wrapped, setWrapped] = useState<Wrapped | null>(null);
  const [card, setCard] = useState(0);
  const [filters, setFilters] = useState<ExploreFilters>(initialSiteId ? { siteId: initialSiteId } : {});
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState<AskState>(null);
  const [loading, setLoading] = useState(false);
  const [clar, setClar] = useState<ClarifyState>({ answers: {}, custom: null });
  const seq = useRef(0);

  useEffect(() => {
    api.fetchDirectory().then(setDirectory).catch((e: unknown) => console.error('Insights directory failed', e));
  }, []);

  const liveBuyerId = directory?.live[0]?.id ?? null;
  const buyerId = source === 'live' ? liveBuyerId : demoBuyerId;
  const buyer = useMemo(() => {
    const live = directory?.live.find((c) => c.id === buyerId);
    if (source === 'live') return live ? { ...live, sites: [] } : null;
    return directory?.demo.find((b) => b.id === buyerId) ?? null;
  }, [directory, source, buyerId]);
  const sites = buyer?.sites ?? [];

  useEffect(() => {
    if (tab !== 'year' || !buyerId) return;
    let alive = true;
    api.fetchWrapped({ buyerId, siteId: yearSite, source })
      .then((w) => { if (alive) { setWrapped(w); setCard(0); } })
      .catch(() => { if (alive) setWrapped({ title: '', cards: [] }); });
    return () => { alive = false; setWrapped(null); };
  }, [tab, buyerId, yearSite, source]);

  /** Asks with the current page state; `over` replaces parts of it when a handler has just changed them. */
  const ask = useCallback(async (text: string, over: { filters?: ExploreFilters; buyerId?: string | null; source?: Source } = {}) => {
    const bid = over.buyerId === undefined ? buyerId : over.buyerId;
    if (!bid) return;
    const mine = ++seq.current; // only the latest question's answer is shown
    setPrompt(text);
    setLoading(true);
    let result: AskState;
    try {
      result = await api.ask({ buyerId: bid, prompt: text, filters: over.filters ?? filters, source: over.source ?? source });
    } catch (e) {
      result = { error: e instanceof Error ? e.message : 'That question could not be answered.' };
    }
    if (mine !== seq.current) return;
    setAnswer(result);
    setClar({ answers: {}, custom: null });
    setLoading(false);
  }, [buyerId, filters, source]);

  // Explore opens on the first starter question; a new source or organisation asks again.
  const openTab = (t: Tab) => {
    setTab(t);
    if (t === 'explore' && !answer && !loading) void ask(STARTERS[0]);
  };
  const reset = (next: { source: Source; buyerId: string | null }) => {
    setAnswer(null); setYearSite(''); setFilters({});
    if (tab === 'explore') void ask(STARTERS[0], { filters: {}, ...next });
  };
  const setSource = (s: Source) => { setSourceState(s); reset({ source: s, buyerId: s === 'live' ? liveBuyerId : demoBuyerId }); };
  const setBuyer = (id: string) => { setDemoBuyerId(id); reset({ source, buyerId: id }); };
  const step = (d: number) => setCard((c) => Math.max(0, Math.min((wrapped?.cards.length ?? 1) - 1, c + d)));
  const setFilter = (key: keyof ExploreFilters, value: string) => {
    const next = { ...filters, [key]: value || undefined };
    setFilters(next);
    void ask(prompt || STARTERS[0], { filters: next });
  };

  /** The chef's answers go back with the original question. */
  const sendClarify = () => {
    if (!answer || !('clarify' in answer)) return;
    const ans = clar.answers;
    let next = filters;
    answer.questions.forEach((q, i) => { if (/drop the filters/i.test(q.q) && ans[i] === 'Yes') next = {}; });
    setFilters(next);
    const inst = answer.questions.findIndex((q, i) => /instead/i.test(q.q) && ans[i]); // "look at X instead" replaces the question
    const extra = answer.questions
      .map((q, i) => (i !== inst && ans[i] && ans[i] !== 'No' ? (ans[i] === 'Yes' ? q.q.replace(/^should i /i, '').replace(/\?$/, '') : ans[i]) : null))
      .filter((x): x is string => Boolean(x));
    void ask([inst >= 0 ? ans[inst] : answer.prompt.replace(/[?.]+$/, ''), ...extra].join(', '), { filters: next });
  };

  return {
    directory, source, setSource, buyerId, buyer, sites, setBuyer, tab, setTab: openTab, yearSite, setYearSite, wrapped, card, step,
    filters, setFilter, prompt, answer, loading, ask, clar, setClar, sendClarify,
  };
}

export type InsightsVM = ReturnType<typeof useInsights>;
