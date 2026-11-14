'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { ChoicesEvent, UiLang } from '@/contracts';
import { t } from './i18n';
import { CheckIcon } from './icons';
import type { ChoiceAnswer } from './thread';

/** Quick-reply buttons. Single choice submits on tap; multi choice collects and submits with "Done". An option id "none" is exclusive. */
export function ChoiceButtons({
  event,
  onSubmit,
  answer,
  lang,
}: {
  event: ChoicesEvent;
  onSubmit: (ids: string[], freeText?: string) => void;
  answer?: ChoiceAnswer;
  lang: UiLang;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const locked = Boolean(answer);
  const chosen = answer?.ids ?? selected;

  const toggle = (id: string) => {
    if (locked) return;
    if (!event.multi) return onSubmit([id]);
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      return id === 'none' ? ['none'] : [...cur.filter((x) => x !== 'none'), id];
    });
  };
  const submit = () => {
    if (locked || (selected.length === 0 && !text.trim())) return;
    onSubmit(selected, text.trim() || undefined);
  };

  const visible = locked ? event.options.filter((o) => chosen.includes(o.id)) : event.options;

  return (
    <div className="mt-2">
      <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.07em] text-muted">{event.question}</div>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {visible.map((option, i) => {
            const on = chosen.includes(option.id);
            return (
              <motion.button
                key={option.id}
                type="button"
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: { delay: locked ? 0 : i * 0.04 } }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                onClick={() => toggle(option.id)}
                disabled={locked}
                aria-pressed={on}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  on
                    ? 'border-blue bg-blue text-white'
                    : 'border-line bg-white text-navy hover:border-blue hover:bg-ice'
                }`}
              >
                {on && event.multi && <CheckIcon size={12} strokeWidth={2.6} />}
                {option.label}
              </motion.button>
            );
          })}
        </AnimatePresence>
        {locked && answer?.freeText && (
          <span className="inline-flex items-center rounded-full border border-blue bg-blue px-3 py-1.5 text-[12.5px] font-medium text-white">
            {answer.freeText}
          </span>
        )}
      </div>

      {!locked && (event.allowFreeText || event.multi) && (
        <div className="mt-2 flex items-center gap-1.5">
          {event.allowFreeText && (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (event.multi) submit();
                  else if (text.trim()) onSubmit([], text.trim());
                }
              }}
              placeholder={t('choices.other', lang)}
              aria-label={`${event.question}: ${t('choices.other', lang)}`}
              className="min-w-0 flex-1 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] text-navy outline-none placeholder:text-muted focus:border-blue focus-visible:outline-none"
            />
          )}
          {event.multi && (
            <button
              type="button"
              onClick={submit}
              disabled={selected.length === 0 && !text.trim()}
              className="rounded-full bg-navy px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-opacity disabled:opacity-30"
            >
              {t('choices.done', lang)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
