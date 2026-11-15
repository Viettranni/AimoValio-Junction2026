'use client';

import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useState } from 'react';

/** What the analyst does for a question, in the order the rails run it (see AnswerCard's STEP_WORDS). */
const STEPS = ['Avaa datasi', 'Katsoo, mitä voi kysyä', 'Ajaa kyselyn', 'Valitsee sopivan kaavion', 'Kirjoittaa yhteenvedon'];
const STEP_MS = 1400;
/** Bar heights (0–1) the mini chart morphs between while it waits. */
const SHAPES = [
  [0.35, 0.6, 0.45, 0.8, 0.55, 0.9, 0.7, 0.5],
  [0.7, 0.4, 0.85, 0.5, 0.95, 0.45, 0.6, 0.8],
  [0.5, 0.75, 0.3, 0.65, 0.4, 0.7, 0.9, 0.35],
];

function useTicker(ms: number, max: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => Math.min(v + 1, max)), ms);
    return () => clearInterval(id);
  }, [ms, max]);
  return n;
}

/** Explore while the analyst works: the question, a chart taking shape, and the steps ticking off. */
export function ThinkingCard({ prompt }: { prompt: string }) {
  const step = useTicker(STEP_MS, STEPS.length - 1);
  const shape = useTicker(900, Number.MAX_SAFE_INTEGER) % SHAPES.length;

  return (
    <MotionConfig reducedMotion="user">
    <article role="status" aria-live="polite" aria-label="Kysytään datalta" className="ik-card relative overflow-hidden p-5 md:p-6">
      {/* A soft light sweeps across the card while it works. */}
      <div aria-hidden="true" className="ik-sweep pointer-events-none absolute inset-0" />

      <div className="relative flex items-center gap-3">
        <span className="relative flex h-9 w-9 flex-none items-center justify-center rounded-full bg-navy text-white">
          <span aria-hidden="true" className="ik-ping absolute inset-0 rounded-full bg-navy" />
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="relative">
            <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Analysoidaan</p>
          <p className="truncate text-[16px] font-semibold text-ink">{prompt ? `“${prompt}”` : 'Kysymyksesi'}</p>
        </div>
      </div>

      <div className="relative mt-6 grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-end">
        {/* Mini chart: bars morph between shapes, a baseline and faint grid underneath. */}
        <div aria-hidden="true" className="relative h-40 rounded-xl bg-[var(--ik-raised)] px-4 pb-3 pt-4">
          <div className="absolute inset-x-4 top-1/3 border-t border-dashed border-line" />
          <div className="absolute inset-x-4 top-2/3 border-t border-dashed border-line" />
          <div className="relative flex h-full items-end gap-2.5">
            {SHAPES[shape].map((h, i) => (
              <motion.span
                key={i}
                className="flex-1 origin-bottom rounded-t-md"
                style={{ background: i === 5 ? 'var(--navy)' : 'color-mix(in srgb, var(--navy) 28%, white)' }}
                initial={{ height: '8%' }}
                animate={{ height: `${Math.round(h * 100)}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 14, delay: i * 0.04 }}
              />
            ))}
          </div>
          <div className="absolute inset-x-4 bottom-3 h-px bg-line" />
        </div>

        <ol className="space-y-2.5 text-[14px]">
          {STEPS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <motion.li
                key={label}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: i <= step ? 1 : 0.4, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
                className="flex items-center gap-2.5"
              >
                <span className="relative flex h-5 w-5 flex-none items-center justify-center">
                  <AnimatePresence mode="wait" initial={false}>
                    {done ? (
                      <motion.svg
                        key="done"
                        width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"
                        initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                      >
                        <circle cx="10" cy="10" r="9" fill="var(--app-teal, #2e8370)" />
                        <motion.path
                          d="M6 10.2l2.6 2.6L14 7.4" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay: 0.05 }}
                        />
                      </motion.svg>
                    ) : active ? (
                      <motion.span key="active" className="ik-spin block h-4 w-4 rounded-full border-2 border-navy border-r-transparent" exit={{ opacity: 0 }} />
                    ) : (
                      <motion.span key="todo" className="block h-2 w-2 rounded-full bg-line" exit={{ opacity: 0 }} />
                    )}
                  </AnimatePresence>
                </span>
                <span className={done ? 'text-ink-soft' : active ? 'font-semibold text-navy' : 'text-muted'}>
                  {label}
                  {active && <span className="ik-dots" aria-hidden="true" />}
                </span>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </article>
    </MotionConfig>
  );
}

/** "Your year" while the story loads: a story card whose progress segments fill and headline lines shimmer. */
export function StoryLoading() {
  return (
    <MotionConfig reducedMotion="user">
    <article role="status" aria-label="Ladataan vuottasi" className="ik-card ik-story-card relative overflow-hidden p-6 md:p-8" data-story-theme="0">
      <div aria-hidden="true" className="ik-sweep pointer-events-none absolute inset-0" />
      <div className="relative mb-6 flex gap-1" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/60">
            <motion.i
              className="absolute inset-y-0 left-0 block rounded-full bg-navy"
              initial={{ width: '0%' }}
              animate={{ width: ['0%', '100%', '100%', '0%'] }}
              transition={{ duration: 2.4, times: [0, 0.35, 0.8, 1], repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
            />
          </i>
        ))}
      </div>
      <div className="relative space-y-3" aria-hidden="true">
        <div className="h-3 w-40 rounded bg-white/70" />
        <div className="ik-glow h-12 w-4/5 max-w-xl rounded-lg bg-white/70" />
        <div className="ik-glow h-12 w-3/5 max-w-md rounded-lg bg-white/70 [animation-delay:200ms]" />
        <div className="flex gap-8 pt-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="ik-glow h-8 w-24 rounded-md bg-white/70" style={{ animationDelay: `${300 + i * 150}ms` }} />
              <div className="h-2.5 w-14 rounded bg-white/60" />
            </div>
          ))}
        </div>
      </div>
      <p className="relative mt-6 text-[13.5px] font-medium text-ink-soft">Kootaan vuottasi<span className="ik-dots" aria-hidden="true" /></p>
    </article>
    </MotionConfig>
  );
}
