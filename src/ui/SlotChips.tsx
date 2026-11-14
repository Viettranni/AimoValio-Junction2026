'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { Intake, IntakeSlot, UiLang } from '@/contracts';
import { REQUIRED_SLOTS } from '@/contracts';
import { formatDay, formatMoney } from './format';
import { dietLabel, t } from './i18n';

function slotText(slot: IntakeSlot, intake: Intake, lang: UiLang): string | null {
  switch (slot) {
    case 'deliveryDate':
      return intake.deliveryDate ? formatDay(intake.deliveryDate, lang) : null;
    case 'guests':
      return intake.guests ? t('slot.guests', lang, { n: intake.guests }) : null;
    case 'menu':
      return intake.menu?.length ? intake.menu.join(' & ') : null;
    case 'budget':
      if (intake.budget === undefined) return null;
      return intake.budget === 'none' ? t('slot.budgetNone', lang) : t('slot.budget', lang, { v: formatMoney(intake.budget, lang) });
    case 'diets':
      if (intake.diets === undefined) return null;
      if (intake.diets === 'none') return t('slot.dietsNone', lang);
      return intake.diets
        .map((d) => `${d.guests} ${dietLabel(d.diet, lang)}`)
        .join(' · ');
  }
}

/** "300 guests · Sat 6 Dec · chicken & rice · budget ? · allergies ?" — tap to edit. */
export function SlotChips({
  intake,
  missing,
  onEdit,
  lang,
}: {
  intake: Intake;
  missing: IntakeSlot[];
  onEdit: (slot: IntakeSlot) => void;
  lang: UiLang;
}) {
  return (
    <div className="flex flex-wrap gap-1 pb-2">
      <AnimatePresence initial={false} mode="popLayout">
        {REQUIRED_SLOTS.map((slot) => {
          const text = slotText(slot, intake, lang);
          const isMissing = missing.includes(slot) || text === null;
          return (
            <motion.button
              key={`${slot}-${isMissing}`}
              type="button"
              layout
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2 }}
              onClick={() => onEdit(slot)}
              title={t('slot.edit', lang)}
              className={`rounded-full px-2.5 py-[3px] text-[11.5px] font-medium tabular-nums transition-colors ${
                isMissing
                  ? 'border border-dashed border-blue/50 text-blue hover:bg-sky'
                  : 'border border-transparent bg-sky text-navy hover:border-blue/40'
              }`}
            >
              {isMissing ? t(`slot.missing.${slot}`, lang) : text}
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
