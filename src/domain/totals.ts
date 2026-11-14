import type { DraftLine, DraftTotals, PortionCategory } from '@/contracts';

const SAFETY_PACK_GROUPS: ReadonlySet<PortionCategory> = new Set([
  'poultry_main', 'meat_main', 'fish_main', 'veg_main', 'grain_side', 'potato_side',
]);

function packBand(line: DraftLine): [number, number] {
  const h = line.history;
  if (h) {
    if (h.choice === 'pending') return [Math.min(h.historyPacks, h.suggestedPacks), Math.max(h.historyPacks, h.suggestedPacks)];
    return [line.packs, line.packs];
  }
  const requested = !line.tags.includes('needed_for_cooking') && !line.tags.includes('addon');
  return [line.packs, requested && SAFETY_PACK_GROUPS.has(line.group) ? line.packs + 1 : line.packs];
}

export function computeTotals(lines: DraftLine[], budget: number | 'none' | undefined): DraftTotals {
  let low = 0, high = 0, lowWithTax = 0, highWithTax = 0;
  for (const line of lines) {
    const [qLow, qHigh] = packBand(line);
    if (line.unitPrice !== null) {
      low += line.unitPrice * qLow;
      high += line.unitPrice * qHigh;
    }
    if (line.unitPriceWithTax !== null) {
      lowWithTax += line.unitPriceWithTax * qLow;
      highWithTax += line.unitPriceWithTax * qHigh;
    }
  }
  const budgetValue = typeof budget === 'number' ? budget : null;
  // With every history choice made, the draft is exactly what will be ordered: no safety-pack range.
  const collapsed = !lines.some((l) => l.history?.choice === 'pending');
  if (collapsed) { high = low; highWithTax = lowWithTax; }
  return {
    low, high, lowWithTax, highWithTax, collapsed,
    budget: budgetValue,
    // `high` is the top of the range the buyer sees (the single figure when collapsed).
    overBudget: budgetValue !== null && high > budgetValue,
  };
}
