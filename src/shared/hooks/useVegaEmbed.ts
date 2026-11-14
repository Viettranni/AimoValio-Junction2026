'use client';

import { useEffect, useState } from 'react';

export type VegaEmbed = (el: HTMLElement, spec: object, opts: object) => Promise<{ finalize: () => void }>;

declare global {
  interface Window { vegaEmbed?: VegaEmbed }
}

// The Vega-Lite runtime, loaded once from the CDN in order (the source app does the same); pinned versions.
const SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/vega@5.30.0/build/vega.min.js',
  'https://cdn.jsdelivr.net/npm/vega-lite@5.21.0/build/vega-lite.min.js',
  'https://cdn.jsdelivr.net/npm/vega-embed@6.26.0/build/vega-embed.min.js',
];

let loading: Promise<VegaEmbed | null> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

function loadVega(): Promise<VegaEmbed | null> {
  loading ??= SCRIPTS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
    .then(() => window.vegaEmbed ?? null)
    .catch((e: unknown) => {
      console.warn('Kaaviot näytetään taulukkoina:', e);
      return null;
    });
  return loading;
}

/** vega-embed once it has loaded; null while loading or when the CDN is unreachable (charts then show as tables). */
export function useVegaEmbed(): { embed: VegaEmbed | null; failed: boolean } {
  const [state, setState] = useState<{ embed: VegaEmbed | null; failed: boolean }>({ embed: null, failed: false });
  useEffect(() => {
    let alive = true;
    loadVega().then((embed) => { if (alive) setState({ embed, failed: embed === null }); });
    return () => { alive = false; };
  }, []);
  return state;
}
