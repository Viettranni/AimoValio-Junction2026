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

/** The MCP link to paste into Claude, with a copy button. Used in the chat and on the static page. */
export function ConnectCard({ info, lang, tone = 'light' }: { info: ConnectEvent; lang: UiLang; tone?: 'light' | 'card' }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <div className={`rounded-xl border border-line ${tone === 'card' ? 'bg-white p-5' : 'bg-white p-3'} text-navy`}>
      <p className={`font-semibold ${tone === 'card' ? 'text-[17px]' : 'text-[13px]'}`}>{t('connect.title', lang)}</p>
      <p className={`mt-1 text-ink-soft ${tone === 'card' ? 'text-[14px]' : 'text-[12px] leading-[17px]'}`}>{t('connect.body', lang)}</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={info.mcpUrl}
          aria-label={t('connect.title', lang)}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-line bg-ice px-2 py-1.5 font-mono text-[11.5px] text-navy"
        />
        <button
          type="button"
          onClick={async () => setCopied(await copyText(info.mcpUrl))}
          className="flex-none rounded-full bg-blue px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-navy"
        >
          <span aria-live="polite">{copied ? t('connect.copied', lang) : t('connect.copy', lang)}</span>
        </button>
      </div>
      {!info.isPublic && <p className="mt-2 text-[11.5px] text-muted">{t('connect.local', lang)}</p>}
    </div>
  );
}
