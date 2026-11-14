'use client';

import { useState } from 'react';
import type { CheckInEvent, UiLang } from '@/contracts';
import { formatQty } from './format';
import { t } from './i18n';
import { HistoryIcon } from './icons';

const SHOWN_LINES = 5;

/** After-event check-in: the order's lines pre-listed, one free-text answer. */
export function CheckInCard({
  event,
  onSubmit,
  answer,
  lang,
}: {
  event: CheckInEvent;
  onSubmit: (text: string) => void;
  answer?: string;
  lang: UiLang;
}) {
  const [text, setText] = useState('');
  const submit = () => text.trim() && onSubmit(text.trim());
  const hidden = event.lines.length - SHOWN_LINES;

  return (
    <div className="aimo-glow rounded-xl px-3.5 py-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-navy">
        <HistoryIcon size={14} className="text-warm-icon" />
        {t('checkin.title', lang, { event: event.eventName.toLowerCase() })}
      </div>
      <p className="mt-0.5 text-[12.5px] text-ink-soft">{t('checkin.prompt', lang)}</p>
      <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink-soft">
        {event.lines.slice(0, SHOWN_LINES).map((l) => (
          <li key={l.lineId} className="flex justify-between gap-3">
            <span className="truncate">{l.productName}</span>
            <span className="flex-none tabular-nums">{formatQty(l.quantity, l.unit, lang)}</span>
          </li>
        ))}
        {hidden > 0 && <li className="text-muted">{t('checkin.more', lang, { n: hidden })}</li>}
      </ul>
      {answer ? (
        <p className="mt-2.5 rounded-lg bg-white/80 px-2.5 py-1.5 text-[12.5px] text-navy">“{answer}”</p>
      ) : (
        <div className="mt-2.5 flex gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('checkin.placeholder', lang)}
            aria-label={t('checkin.prompt', lang)}
            className="min-w-0 flex-1 rounded-full border border-warm-border bg-white px-3 py-1.5 text-[12.5px] text-navy outline-none placeholder:text-muted focus:border-warm-icon focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className="rounded-full bg-navy px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-30"
          >
            {t('checkin.save', lang)}
          </button>
        </div>
      )}
    </div>
  );
}
