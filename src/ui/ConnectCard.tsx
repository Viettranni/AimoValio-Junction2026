'use client';

import { useEffect, useState } from 'react';
import type { ConnectEvent, UiLang } from '@/contracts';
import { t } from './i18n';

/** Copies text; falls back to a hidden textarea where the Clipboard API is blocked (e.g. some iframes). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** claude.ai's connector settings. There is no documented link that pre-fills a custom connector, so this opens the page
 * with the link already on the clipboard: Add → Add custom connector → paste. */
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';

/** Claude Code adds the server with one command, no pasting in a UI. */
export const claudeCodeCommand = (localMcpUrl: string) => `claude mcp add --transport http aimo "${localMcpUrl}"`;

/**
 * Connect Claude to Aimo: "Open in Claude" copies the link and opens claude.ai's connectors page in one click; the
 * link and the Claude Code command can also be copied on their own. Used in the chat and on the static page.
 */
export function ConnectCard({ info, lang, tone = 'light' }: { info: ConnectEvent; lang: UiLang; tone?: 'light' | 'card' }) {
  const [done, setDone] = useState<'opened' | 'link' | 'code' | null>(null);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(null), done === 'opened' ? 15000 : 2000);
    return () => clearTimeout(id);
  }, [done]);
  const big = tone === 'card';
  const small = big ? 'text-[13px]' : 'text-[11.5px]';

  const openInClaude = async () => {
    // Copy first: once the new tab has focus, this page may no longer write to the clipboard.
    const copied = await copyText(info.mcpUrl);
    window.open(CLAUDE_CONNECTORS_URL, '_blank', 'noopener');
    setDone(copied ? 'opened' : null);
  };

  return (
    <div className={`rounded-xl border border-line bg-white ${big ? 'p-5' : 'p-3'} text-navy`}>
      <p className={`font-semibold ${big ? 'text-[17px]' : 'text-[13px]'}`}>{t('connect.title', lang)}</p>
      <p className={`mt-1 text-ink-soft ${big ? 'text-[14px]' : 'text-[12px] leading-[17px]'}`}>{t('connect.body', lang)}</p>

      {info.isPublic ? (
        <button
          type="button"
          onClick={openInClaude}
          className={`mt-3 inline-flex items-center gap-2 rounded-full bg-lime px-4 py-2 font-semibold text-lime-ink transition-colors hover:bg-lime-hover ${big ? 'text-[15px]' : 'text-[13px]'}`}
        >
          {t('connect.open', lang)} ↗
        </button>
      ) : (
        <p className={`mt-2 text-muted ${small}`}>{t('connect.local', lang)}</p>
      )}
      {done === 'opened' && (
        <p role="status" className={`mt-2 rounded-lg bg-ice px-2.5 py-2 text-navy ${small}`}>{t('connect.openedHint', lang)}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          readOnly
          value={info.mcpUrl}
          aria-label={t('connect.title', lang)}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-line bg-ice px-2 py-1.5 font-mono text-[11.5px] text-navy"
        />
        <button
          type="button"
          onClick={async () => setDone((await copyText(info.mcpUrl)) ? 'link' : null)}
          className="flex-none rounded-full border border-blue px-3 py-1.5 text-[12.5px] font-semibold text-blue transition-colors hover:bg-ice"
        >
          <span aria-live="polite">{done === 'link' ? t('connect.copied', lang) : t('connect.copy', lang)}</span>
        </button>
      </div>

      <div className={`mt-2 flex items-center justify-between gap-2 text-muted ${small}`}>
        <span className="min-w-0 truncate">{t('connect.code', lang)} <code className="font-mono text-navy">claude mcp add …</code></span>
        <button
          type="button"
          onClick={async () => setDone((await copyText(claudeCodeCommand(info.localMcpUrl))) ? 'code' : null)}
          className="flex-none font-semibold text-blue hover:underline"
        >
          {done === 'code' ? t('connect.copied', lang) : t('connect.copyCommand', lang)}
        </button>
      </div>
    </div>
  );
}
