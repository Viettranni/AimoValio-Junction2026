'use client';

// ViewModel for the Restaurants page: the organisation picker, its restaurants and the open restaurant's panel.
import { useEffect, useState } from 'react';
import type { Kitchens } from '@/insights/views';
import { fetchDirectory, json, type DirectoryEntry } from '@/features/insights/api/insightsApi';

export type SiteTab = 'overview' | 'people' | 'deliveries' | 'rules';

async function fetchRestaurants(buyerId: string): Promise<Kitchens> {
  return json<Kitchens>(await fetch(`/api/restaurants?${new URLSearchParams({ buyerId })}`, { cache: 'no-store' }));
}

export function useRestaurants() {
  const [orgs, setOrgs] = useState<DirectoryEntry[]>([]);
  const [buyerId, setBuyerId] = useState('BUY-POHJOLA');
  const [data, setData] = useState<Kitchens | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSite, setOpenSite] = useState<string | null>(null);
  const [siteTab, setSiteTab] = useState<SiteTab>('overview');

  useEffect(() => {
    fetchDirectory().then((d) => setOrgs(d.demo)).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load'));
  }, []);

  useEffect(() => {
    let alive = true;
    fetchRestaurants(buyerId)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load'); });
    return () => { alive = false; setData(null); };
  }, [buyerId]);

  const site = data?.sites.find((s) => s.id === openSite) ?? null;
  const open = (id: string | null) => { setOpenSite(id); setSiteTab('overview'); };
  const pickOrg = (id: string) => { setBuyerId(id); setOpenSite(null); };

  return { orgs, buyerId, pickOrg, data, error, site, open, siteTab, setSiteTab };
}

export type RestaurantsVM = ReturnType<typeof useRestaurants>;
