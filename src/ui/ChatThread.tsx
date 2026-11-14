'use client';

import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { UiLang } from '@/contracts';
import { CheckInCard } from './CheckInCard';
import { ConnectCard } from './ConnectCard';
import { ChoiceButtons } from './ChoiceButtons';
import { t, type UiKey } from './i18n';
import { SendIcon } from './icons';
import { PlanningChecklist } from './PlanningChecklist';
import { ShelfCard } from './ShelfShuffle';
import type { ThreadItem } from './thread';

const enter = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const } };

export function ChatThread({
  items,
  typing,
  lang,
  examples,
  onExample,
  onChoice,
  onCheckIn,
  onCheckInConfirm,
  onRetry,
}: {
  items: ThreadItem[];
  typing: boolean;
  lang: UiLang;
  /** Example prompts offered under the greeting. */
  examples: UiKey[];
  onExample: (text: string) => void;
  onChoice: (itemId: string, ids: string[], freeText?: string) => void;
  onCheckIn: (itemId: string, text: string) => void;
  onCheckInConfirm: (itemId: string, entries: Array<{ lineId: string; leftoverQty: number }>) => Promise<void>;
  onRetry: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const started = items.some((i) => i.kind === 'user');

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [items, typing]);

  return (
    // `relative` makes the thread the containing block of its absolutely positioned descendants (the loaders'
    // sr-only live regions). Without it they resolve against the iframe's viewport at their in-thread offset,
    // so the embedded document grows and the thread "scrolls on" into blank space below the last message.
    // `overscroll-contain` keeps a scroll that reaches the end from chaining into the host page.
    <div ref={scroller} className="aimo-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pb-3 pt-4" aria-live="polite">
      <div className="flex flex-col gap-2.5">
        {items.map((item) => {
          switch (item.kind) {
            case 'greeting':
              return (
                <motion.div key={item.id} {...enter} className="flex flex-col gap-2">
                  <AssistantBubble>{t('greeting', lang)}</AssistantBubble>
                  {!started && (
                    <div className="flex flex-col gap-1.5">
                      {examples.map((key, i) => (
                        <motion.button
                          key={key}
                          type="button"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.15 + i * 0.07, duration: 0.25 }}
                          onClick={() => onExample(t(key, lang))}
                          className="group flex items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-left text-[12.5px] text-navy transition-colors hover:border-blue hover:bg-ice"
                        >
                          <span>{t(key, lang)}</span>
                          <SendIcon size={13} className="flex-none text-muted transition-colors group-hover:text-blue" />
                        </motion.button>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            case 'user':
              return (
                <motion.div
                  key={item.id}
                  {...enter}
                  className="ml-auto max-w-[85%] whitespace-pre-line rounded-[14px_14px_4px_14px] bg-blue px-3 py-2 text-[13px] leading-[19px] text-white"
                >
                  {item.text}
                </motion.div>
              );
            case 'assistant':
              return (
                <motion.div key={item.id} {...enter}>
                  <AssistantBubble>
                    <LightText text={item.text} />
                  </AssistantBubble>
                </motion.div>
              );
            case 'choices':
              return (
                <motion.div key={item.id} {...enter} className="pr-4">
                  <ChoiceButtons
                    event={item.event}
                    answer={item.answer}
                    lang={lang}
                    onSubmit={(ids, freeText) => onChoice(item.id, ids, freeText)}
                  />
                </motion.div>
              );
            case 'progress':
              return (
                <motion.div key={item.id} {...enter} className="pr-6">
                  <PlanningChecklist events={item.events} lang={lang} />
                </motion.div>
              );
            case 'checkin':
              return (
                <motion.div key={item.id} {...enter} className="pr-4">
                  <CheckInCard
                    event={item.event}
                    answer={item.answer}
                    confirmed={item.confirmed}
                    lang={lang}
                    onSubmit={(text) => onCheckIn(item.id, text)}
                    onConfirm={(entries) => onCheckInConfirm(item.id, entries)}
                  />
                </motion.div>
              );
            case 'connect':
              return (
                <motion.div key={item.id} {...enter} className="pr-4">
                  <ConnectCard info={item.event} lang={lang} />
                </motion.div>
              );
            case 'error':
              return (
                <motion.div
                  key={item.id}
                  {...enter}
                  role="status"
                  className="flex max-w-[92%] items-center gap-3 rounded-[14px_14px_14px_4px] border border-line bg-white px-3 py-2 text-[12.5px] leading-[18px] text-ink-soft"
                >
                  <span className="flex-1">{item.text}</span>
                  {item.retry && (
                    <button type="button" onClick={onRetry} className="flex-none font-semibold text-blue hover:underline">
                      {t('chat.retry', lang)}
                    </button>
                  )}
                </motion.div>
              );
          }
        })}
        {typing && (
          <motion.div key="shelf" {...enter}>
            <ShelfCard />
          </motion.div>
        )}
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[92%] rounded-[14px_14px_14px_4px] bg-ice px-3 py-2 text-[13px] leading-[19px] text-navy">
      {children}
    </div>
  );
}

/**
 * Model replies sometimes carry a little markdown. Keep bold and line breaks, drop list markers and
 * headings, so the bubble stays prose rather than a rendered document.
 */
function LightText({ text }: { text: string }) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|#{1,6}|\d+\.)\s+/, '').trim())
    .filter(Boolean);
  return lines.map((line, i) => (
    <p key={i} className={i > 0 ? 'mt-1.5' : undefined}>
      {line.split(/(\*\*[^*]+\*\*)/).map((chunk, j) =>
        chunk.startsWith('**') && chunk.endsWith('**') ? (
          <b key={j} className="font-semibold">
            {chunk.slice(2, -2)}
          </b>
        ) : (
          chunk
        ),
      )}
    </p>
  ));
}
