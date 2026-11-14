import Link from 'next/link';
import type { ReactNode } from 'react';
import '../aiGlow.css';

/** A menu link marked as AI-powered: glowing lime border and a sparkle badge in the top-right corner. */
export function AiNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="ai-glow relative inline-block rounded-full px-3.5 py-1">
      {children}
      <span className="ai-glow-star" aria-label="Tekoäly" role="img">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z" />
          <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
        </svg>
      </span>
    </Link>
  );
}
