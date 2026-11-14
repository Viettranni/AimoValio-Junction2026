'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'aimo-insights-theme';
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system'; // storage blocked (private mode): fall back to the system theme
  }
}

/** The viewer's theme for the insights pages, remembered in this browser. */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const theme = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    read,
    (): Theme => 'system',
  );
  const setTheme = useCallback((t: Theme) => {
    try { window.localStorage.setItem(KEY, t); } catch { /* not remembered; still applied below */ }
    listeners.forEach((l) => l());
  }, []);
  return { theme, setTheme };
}
