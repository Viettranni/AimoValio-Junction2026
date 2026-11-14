import type { Draft, DraftDiff, DraftLine, UiLang } from '@/contracts';
import { formatMoney, formatQty } from './format';
import { t } from './i18n';

const MAX_PARTS = 3;

const labelOf = (draft: Draft, line: DraftLine) =>
  draft.components.find((c) => c.id === line.componentId)?.label ?? line.productName;

/** "Chicken 60 kg → 75 kg · total €1,433": the chat's short echo of a click edit on the sheet. */
export function describeEdit(before: Draft, after: Draft, diff: DraftDiff, lang: UiLang): string | null {
  const parts: string[] = [];
  for (const id of diff.changedLineIds) {
    const a = after.lines.find((l) => l.id === id);
    const b = before.lines.find((l) => l.id === id);
    if (a && b && a.quantity !== b.quantity) {
      parts.push(`${labelOf(after, a)} ${formatQty(b.quantity, b.unit, lang)} → ${formatQty(a.quantity, a.unit, lang)}`);
    }
  }
  for (const id of diff.removedLineIds) {
    const b = before.lines.find((l) => l.id === id);
    if (b) parts.push(t('note.removed', lang, { name: labelOf(before, b) }));
  }
  for (const id of diff.addedLineIds) {
    const a = after.lines.find((l) => l.id === id);
    if (a) parts.push(t('note.added', lang, { name: labelOf(after, a) }));
  }
  if (!parts.length) return null;

  const { low, high, collapsed } = after.totals;
  const total = collapsed || Math.round(low) === Math.round(high)
    ? formatMoney(high, lang)
    : `${formatMoney(low, lang)}–${formatMoney(high, lang)}`;
  return [...parts.slice(0, MAX_PARTS), t('note.total', lang, { v: total })].join(' · ');
}
