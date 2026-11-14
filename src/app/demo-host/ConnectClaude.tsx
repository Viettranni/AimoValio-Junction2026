'use client';

import { useEffect, useState } from 'react';
import type { ConnectEvent } from '@/contracts';
import { ConnectCard } from '@/ui/ConnectCard';

/** The copy-paste MCP link on the static page; fetched so it shows the tunnel URL `npm run dev` opened. */
export function ConnectClaude() {
  const [info, setInfo] = useState<ConnectEvent | null>(null);
  useEffect(() => {
    fetch('/api/connect').then((r) => r.json()).then(setInfo).catch(() => setInfo(null));
  }, []);
  if (!info) return null;
  return <ConnectCard info={info} lang="fi" tone="card" />;
}
