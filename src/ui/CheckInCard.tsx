'use client';

import { useState } from 'react';
import type { CheckInEvent, UiLang } from '@/contracts';
import { formatNumber, formatQty } from './format';
import { t } from './i18n';
import { HistoryIcon } from './icons';
import { shortName } from './productName';
import { SECONDARY_BUTTON } from './styles';

const SHOWN_LINES = 5;

/**
 * After-event check-in. Without parsed numbers it asks for one free-text reply; once the assistant has parsed
 * the reply (lines carry `leftoverQty`) it shows an editable table to confirm.
 */
export function CheckInCard({
  event,
  onSubmit,
  onConfirm,
  answer,
  confirmed,
  lang,
}: {
  event: CheckInEvent;
  onSubmit: (text: string) => void;
  onConfirm?: (entries: Array<{ lineId: string; leftoverQty: number }>) => Promise<void>;
  answer?: string;
  confirmed?: boolean;
  lang: UiLang;
}) {
  const parsed = event.lines.some((l) => l.leftoverQty !== undefined);
  return (
    <div className="aimo-glow rounded-xl px-3.5 py-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-navy">
        <HistoryIcon size={14} className="text-warm-icon" />
        {t('checkin.title', lang, { event: event.eventName.toLowerCase() })}
      </div>
      {parsed && onConfirm ? (
        <LeftoverTable event={event} onConfirm={onConfirm} confirmed={confirmed} lang={lang} />
      ) : (
        <ReplyForm event={event} onSubmit={onSubmit} answer={answer} lang={lang} />
      )}
    </div>
  );
}

function ReplyForm({ event, onSubmit, answer, lang }: { event: CheckInEvent; onSubmit: (text: string) => void; answer?: string; lang: UiLang }) {
  const [text, setText] = useState('');
  const submit = () => text.trim() && onSubmit(text.trim());
  const hidden = event.lines.length - SHOWN_LINES;
  return (
    <>
      <p className="mt-0.5 text-[12.5px] text-ink-soft">{t('checkin.prompt', lang)}</p>
      <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink-soft">
        {event.lines.slice(0, SHOWN_LINES).map((l) => (
          <li key={l.lineId} className="flex justify-between gap-3">
            <span className="truncate" title={l.productName}>{shortName(l.productName)}</span>
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
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] ${SECONDARY_BUTTON}`}
          >
            {t('checkin.save', lang)}
          </button>
        </div>
      )}
    </>
  );
}

/** Amounts are entered as a size plus a direction, so nobody has to type a minus sign. */
function LeftoverTable({
  event,
  onConfirm,
  confirmed,
  lang,
}: {
  event: CheckInEvent;
  onConfirm: (entries: Array<{ lineId: string; leftoverQty: number }>) => Promise<void>;
  confirmed?: boolean;
  lang: UiLang;
}) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(event.lines.map((l) => [l.lineId, { amount: Math.abs(l.leftoverQty ?? 0), short: (l.leftoverQty ?? 0) < 0 }])),
  );
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const locked = confirmed || saving;

  const set = (lineId: string, patch: Partial<{ amount: number; short: boolean }>) =>
    setValues((v) => ({ ...v, [lineId]: { ...v[lineId], ...patch } }));

  const confirm = async () => {
    setSaving(true);
    setFailed(false);
    try {
      await onConfirm(event.lines.map((l) => ({ lineId: l.lineId, leftoverQty: (values[l.lineId].short ? -1 : 1) * values[l.lineId].amount })));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2">
      <ul className="text-[11.5px] text-ink-soft">
        {event.lines.map((l) => {
          const v = values[l.lineId];
          return (
            <li key={l.lineId} className="border-t border-warm-border/60 py-1.5 first:border-t-0">
              <div className="truncate text-navy" title={l.productName}>{shortName(l.productName)}</div>
              {l.deliveredShort && (
                <div className="text-[10.5px] font-medium text-warn">
                  {t('delivery.short', lang, { d: formatQty(l.quantity - l.deliveredShort.qty, l.unit, lang), o: formatQty(l.quantity, l.unit, lang) })}
                </div>
              )}
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="tabular-nums">
                  {t('checkin.ordered', lang)} {formatQty(l.quantity, l.unit, lang)}
                </span>
                {confirmed ? (
                  <span className="block text-right tabular-nums">
                    {v.amount === 0 ? '—' : `${v.short ? '−' : '+'}${formatNumber(v.amount, lang)} ${t(`unit.${l.unit}`, lang)}`}
                  </span>
                ) : (
                  <span className="flex items-center justify-end gap-1">
                    <span role="radiogroup" aria-label={l.productName} className="inline-flex overflow-hidden rounded-full border border-warm-border bg-white text-[10.5px] font-semibold">
                      {([false, true] as const).map((short) => (
                        <button
                          key={String(short)}
                          type="button"
                          role="radio"
                          aria-checked={v.short === short}
                          onClick={() => set(l.lineId, { short })}
                          disabled={locked}
                          className={`px-2 py-0.5 ${v.short === short ? (short ? 'bg-warn/15 text-warn' : 'bg-warm text-warm-ink') : 'text-muted'}`}
                        >
                          {short ? `− ${t('checkin.short', lang)}` : `+ ${t('checkin.left', lang)}`}
                        </button>
                      ))}
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={v.amount}
                      disabled={locked}
                      onChange={(e) => set(l.lineId, { amount: Math.max(0, Number(e.target.value) || 0) })}
                      aria-label={`${l.productName} ${t(`unit.${l.unit}`, lang)}`}
                      className="w-14 rounded-md border border-warm-border bg-white px-1.5 py-0.5 text-right tabular-nums text-navy outline-none focus:border-warm-icon focus-visible:outline-none"
                    />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {failed && <p className="mt-1.5 text-[11.5px] text-warn">{t('chat.editFailed', lang)}</p>}
      {!confirmed && (
        <button
          type="button"
          onClick={confirm}
          disabled={saving}
          className={`mt-2 rounded-full px-3.5 py-1.5 text-[12.5px] ${SECONDARY_BUTTON}`}
        >
          {t('checkin.confirm', lang)}
        </button>
      )}
    </div>
  );
}
