'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, type SVGProps } from 'react';
import { t, type UiKey } from './i18n';
import {
  ANNOUNCE_MS, REDUCED_ROLL_MS, ROLL_MS, productsFromNames, rollIndex, scramblePrice, type ShelfGroup, type ShelfMode, type ShelfProduct,
} from './shelf';
import { useShelf, useThrottled, useTick } from './useProductSample';

// ───────────── Pictograms: 24-unit line icons, one per shelf group ─────────────

function Glyph({ size = 16, children, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

const GLYPHS: Record<ShelfGroup, React.ReactNode> = {
  // Drumstick
  poultry: (
    <>
      <ellipse cx="15" cy="9" rx="6.2" ry="4.6" transform="rotate(-45 15 9)" />
      <path d="M10.6 13.4 7.2 16.8" />
      <circle cx="5.4" cy="17.2" r="1.6" />
      <circle cx="6.8" cy="18.6" r="1.6" />
    </>
  ),
  // Bowl of grains
  grains: (
    <>
      <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0z" />
      <path d="M8 11.5c.3-2.4 2-4 4-4s3.7 1.6 4 4" />
      <path d="M12 4v1.5M8.5 5.5l.6 1.2M15.5 5.5l-.6 1.2" />
    </>
  ),
  // Milk carton
  dairy: (
    <>
      <path d="M8.5 3h7v3l2 3.2V21h-11V9.2l2-3.2z" />
      <path d="M6.5 9.2h11M8.5 6h7" />
      <path d="M10 14h4" />
    </>
  ),
  // Leaf
  veg: (
    <>
      <path d="M5 19c0-8.3 5.6-14 15-14 0 9.4-5.7 15-14 15" />
      <path d="M5 19l8.5-8.5" />
    </>
  ),
  // Bottle
  pantry: (
    <>
      <path d="M10 2.5h4" />
      <path d="M10.5 2.5v3.8L8 10v11h8V10l-2.5-3.7V2.5" />
      <path d="M8 14h8" />
    </>
  ),
  // Crate
  generic: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
};

export function ShelfGlyph({ group, size }: { group: ShelfGroup; size?: number }) {
  return <Glyph size={size}>{GLYPHS[group]}</Glyph>;
}

function ShieldCheck({ size = 12 }: { size?: number }) {
  return (
    <Glyph size={size} strokeWidth={2}>
      <path d="M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6z" />
      <motion.path d="M9 12l2.2 2.2L15.2 10" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25, delay: 0.08 }} />
    </Glyph>
  );
}

// ───────────── Shared pieces ─────────────

const ANNOUNCE_KEY: Record<ShelfMode, UiKey> = {
  browse: 'shelf.say.browse',
  search: 'shelf.say.search',
  prices: 'shelf.say.prices',
  allergens: 'shelf.say.allergens',
};

/** The rolling product for this component, plus the clock and reduced-motion state that drive it. */
function useRoll(products: ShelfProduct[], offset = 0) {
  const { running } = useShelf();
  const reduce = !!useReducedMotion();
  const tick = useTick(reduce ? REDUCED_ROLL_MS : ROLL_MS, running && products.length > 1);
  const index = rollIndex(tick, products.length, offset);
  return { product: products[index] as ShelfProduct | undefined, tick, index, reduce };
}

/** Polite, throttled narration of what the roll is looking at (the roll itself is hidden from screen readers). */
function Announce({ mode, name }: { mode: ShelfMode; name?: string }) {
  const { lang } = useShelf();
  const text = useThrottled(name ? t(ANNOUNCE_KEY[mode], lang, { name }) : '', ANNOUNCE_MS);
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {text}
    </span>
  );
}

/** Thin lime indeterminate bar on a sky track (the CSS animation stops with reduced motion or when paused). */
export function LimeBar({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`aimo-indeterminate h-[2px] overflow-hidden bg-sky ${className}`}>
      <span className="block h-full w-1/3 rounded-full bg-lime" />
    </div>
  );
}

/**
 * The one roll every loader uses: the old item leaves upwards, then the new one comes up from below, inside a
 * clipped slot (use with AnimatePresence mode="wait"). Exit 0.12 s + enter 0.18 s stays under ROLL_MS, so only
 * one name is ever legible.
 */
export const ROLL = {
  initial: { y: '100%', opacity: 0 },
  animate: { y: '0%', opacity: 1, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { y: '-100%', opacity: 0, transition: { duration: 0.12, ease: [0.55, 0, 1, 0.45] as const } },
};

// ───────────── Chat card: "Aimo is browsing the shelves" ─────────────

/** Shown in the chat while the assistant works without visible progress: real catalogue products flip past. */
export function ShelfCard() {
  const { products, lang } = useShelf();
  const { product, index, reduce } = useRoll(products);

  return (
    <div className="relative w-[260px] max-w-[92%] overflow-hidden rounded-[14px_14px_14px_4px] border border-line bg-white" role="group" aria-label={t('shelf.title', lang)}>
      <div className="flex h-[62px] items-center gap-3 px-3">
        <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-sky text-blue">
          {product && (reduce ? (
            <ShelfGlyph group={product.group} size={17} />
          ) : (
            <AnimatePresence initial={false} mode="wait">
              <motion.span key={index} {...ROLL} className="flex">
                <ShelfGlyph group={product.group} size={17} />
              </motion.span>
            </AnimatePresence>
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[11.5px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-muted">
            {reduce && products.length ? t('shelf.count', lang, { n: products.length }) : t('shelf.title', lang)}
          </div>
          <div className="relative mt-0.5 h-[34px] overflow-hidden" aria-hidden="true">
            {product ? (
              reduce ? (
                <ProductLines product={product} />
              ) : (
                <AnimatePresence initial={false} mode="wait">
                  <motion.div key={index} {...ROLL} className="absolute inset-0">
                    <ProductLines product={product} />
                  </motion.div>
                </AnimatePresence>
              )
            ) : (
              <div className="space-y-1.5 pt-1">
                <div className="aimo-shimmer h-3 w-40 rounded" />
                <div className="aimo-shimmer h-2.5 w-24 rounded" />
              </div>
            )}
          </div>
        </div>
      </div>
      <LimeBar />
      <Announce mode="browse" name={product?.displayName} />
    </div>
  );
}

function ProductLines({ product }: { product: ShelfProduct }) {
  return (
    <>
      <div className="truncate text-[13px] font-medium leading-[18px] text-navy">{product.displayName}</div>
      <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted">
        {product.packDescription && <span className="truncate">{product.packDescription}</span>}
        {product.supplier && (
          <span className="flex-none truncate rounded bg-ice px-1 text-[10px] leading-[14px] text-ink-soft">{product.supplier}</span>
        )}
      </div>
    </>
  );
}

// ───────────── Planning checklist: the roll under the active step ─────────────

/**
 * Compact roll under a running checklist step. "Searching" flips candidate names, "Prices and stock" adds a
 * price being worked out, "Checking allergens" ticks a shield on each product. Uses the step's own ticker
 * names when the pipeline sent them, else the conversation sample.
 */
export function StepShuffle({ mode, names }: { mode: ShelfMode; names?: string[] }) {
  const shelf = useShelf();
  const named = useMemo(() => (names?.length ? productsFromNames(names) : null), [names]);
  const products = named ?? shelf.products;
  const { product, index, tick, reduce } = useRoll(products);
  if (!product) return <div className="aimo-shimmer mt-1 h-4 w-44 rounded" aria-hidden="true" />;

  const row = (
    <div className="absolute inset-0 flex items-center gap-1.5">
      <span className="flex-none text-blue/70">
        <ShelfGlyph group={product.group} size={12} />
      </span>
      <span className="min-w-0 truncate">
        {reduce && <span className="text-muted">{t('shelf.count', shelf.lang, { n: products.length })} </span>}
        {product.displayName}
      </span>
      {mode === 'allergens' && (
        <span className="flex-none text-ok">
          <ShieldCheck key={index} />
        </span>
      )}
    </div>
  );

  return (
    <div className="mt-0.5 flex items-center gap-2">
      <div className="relative h-4 min-w-0 flex-1 overflow-hidden text-[11.5px] leading-4 text-blue" aria-hidden="true">
        {reduce ? (
          row
        ) : (
          <AnimatePresence initial={false} mode="wait">
            <motion.div key={index} {...ROLL} className="absolute inset-0">
              {row}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      {mode === 'prices' && (
        <span aria-hidden="true" className="aimo-shimmer flex-none rounded px-1.5 text-[10.5px] font-medium leading-4 text-ink-soft tabular-nums">
          € {reduce ? '··,··' : scramblePrice(tick, index)}
        </span>
      )}
      <Announce mode={mode} name={product.displayName} />
    </div>
  );
}
