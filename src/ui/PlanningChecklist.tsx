'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { ProgressEvent, ProgressStepId, UiLang } from '@/contracts';
import { t } from './i18n';

interface StepState {
  step: ProgressStepId;
  done: boolean;
  result?: string;
  ticker?: string[];
}

function reduceSteps(events: ProgressEvent[]): StepState[] {
  const steps: StepState[] = [];
  for (const e of events) {
    let s = steps.find((x) => x.step === e.step);
    if (!s) steps.push((s = { step: e.step, done: false }));
    if (e.status === 'start') s.ticker = e.ticker;
    else Object.assign(s, { done: true, result: e.label });
  }
  return steps;
}

/** Live narration of the planning pipeline: pulsing dot → check, result fades in, catalogue hits flicker by. */
export function PlanningChecklist({ events, lang }: { events: ProgressEvent[]; lang: UiLang }) {
  const steps = reduceSteps(events);
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(0,32,91,0.04)]">
      <ol className="space-y-2">
        <AnimatePresence initial={false}>
          {steps.map((s) => (
            <motion.li
              key={s.step}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-start gap-2.5"
            >
              <StepDot done={s.done} />
              <div className="min-w-0 flex-1">
                <div className={`text-[12.5px] leading-[18px] ${s.done ? 'text-ink-soft' : 'font-medium text-navy'}`}>
                  {t(`step.${s.step}`, lang)}
                </div>
                {!s.done && s.ticker && <Ticker names={s.ticker} />}
                {s.done && s.result && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className="text-[11.5px] leading-4 text-muted tabular-nums"
                  >
                    {s.result}
                  </motion.div>
                )}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

function StepDot({ done }: { done: boolean }) {
  return (
    <span className="relative mt-[3px] flex h-3 w-3 flex-none items-center justify-center">
      {done ? (
        <motion.svg viewBox="0 0 12 12" className="h-3 w-3" initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
          <circle cx="6" cy="6" r="6" fill="var(--ok)" />
          <motion.path
            d="M3.4 6.2l1.8 1.8 3.4-3.6"
            fill="none"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.25, delay: 0.05 }}
          />
        </motion.svg>
      ) : (
        <>
          <span className="aimo-pulse absolute h-2 w-2 rounded-full bg-blue/40" />
          <span className="relative h-2 w-2 rounded-full bg-blue" />
        </>
      )}
    </span>
  );
}

/** Product names flicker past while the catalogue search runs. */
function Ticker({ names }: { names: string[] }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % names.length), 120);
    return () => clearInterval(id);
  }, [names.length, reduce]);
  if (reduce) return <div className="truncate text-[11.5px] leading-4 text-blue">{names[0]}</div>;
  return (
    <div className="relative h-4 overflow-hidden text-[11.5px] leading-4 text-blue" aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.div
          key={index}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: 0.1 }}
          className="absolute inset-x-0 truncate"
        >
          {names[index]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
