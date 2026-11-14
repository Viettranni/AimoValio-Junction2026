'use client';

import type { ReactNode } from 'react';

declare global {
  interface Window {
    AimoWidget?: { open: () => void };
  }
}

export function OpenAssistantButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.AimoWidget?.open()}>
      {children}
    </button>
  );
}
