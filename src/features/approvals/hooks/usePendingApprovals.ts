'use client';

import { useEffect, useState } from 'react';
import { fetchPendingCount } from '../api/approvalsApi';

/** Often enough that a new request shows up while the demo is on screen, rare enough to stay cheap. */
const REFRESH_MS = 15_000;

/** Pending approval count for the menu badge; null until known or when the request fails (badge just hides). */
export function usePendingApprovals(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetchPendingCount().then(
        (n) => { if (active) setCount(n); },
        () => { if (active) setCount(null); },
      );
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  return count;
}
