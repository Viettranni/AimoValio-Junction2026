'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { UiLang } from '@/contracts';
import { t } from './i18n';
import { SlidersIcon } from './icons';

/** Only rendered with ?demo=1. */
export function DemoControls({
  fast,
  onFastForward,
  onReset,
  onToggleFast,
  lang,
}: {
  fast: boolean;
  onFastForward: () => void;
  onReset: () => void;
  onToggleFast: () => void;
  lang: UiLang;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const act = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('header.demo', lang)}
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <SlidersIcon size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-10 z-20 w-64 origin-top-right rounded-xl border border-line bg-white p-1.5 text-[12.5px] text-navy shadow-card"
          >
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">{t('demo.title', lang)}</div>
            <MenuButton onClick={act(onFastForward)}>{t('demo.ff', lang)}</MenuButton>
            <MenuButton onClick={act(onReset)}>{t('demo.reset', lang)}</MenuButton>
            <MenuButton onClick={onToggleFast}>
              <span className="flex-1">{t('demo.fast', lang)}</span>
              <span className={`relative h-4 w-7 rounded-full transition-colors ${fast ? 'bg-blue' : 'bg-line'}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[left] ${fast ? 'left-3.5' : 'left-0.5'}`} />
              </span>
            </MenuButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-ice">
      {children}
    </button>
  );
}
