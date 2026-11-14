import type { EventType, HistoryAdjustment, HistoryBasis, LeftoverRecord, MeasureUnit, PortionCategory } from '@/contracts';

const HALF_LIFE_DAYS = 182;
const DAY_MS = 86_400_000;

interface Input {
  productId: string;
  category: PortionCategory;
  eventType: EventType;
  suggestedQty: number;
  unit: MeasureUnit;
  records: LeftoverRecord[];
  now: Date;
}

export function computeHistoryAdjustment(input: Input): HistoryAdjustment | null {
  const usable = input.records.filter((r) => r.unit === input.unit && r.orderedQty > 0);
  const tiers: Array<[HistoryBasis, LeftoverRecord[]]> = [
    ['same_product', usable.filter((r) => r.productId === input.productId)],
    ['same_category_event', usable.filter((r) => r.category === input.category && r.eventType === input.eventType)],
    ['same_category', usable.filter((r) => r.category === input.category)],
  ];
  for (const [basis, used] of tiers) {
    const enough =
      used.length >= 2 ||
      (basis === 'same_product' && used.length === 1 && used[0].eventType === input.eventType);
    if (enough) return build(input, basis, used);
  }
  return null;
}

function build(input: Input, basis: HistoryBasis, used: LeftoverRecord[]): HistoryAdjustment {
  let weighted = 0;
  let weights = 0;
  for (const r of used) {
    const ageDays = Math.max(0, (input.now.getTime() - Date.parse(r.eventDate)) / DAY_MS);
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    weighted += w * (r.leftoverQty / r.orderedQty);
    weights += w;
  }
  const ratio = weighted / weights;
  const last = used.reduce((a, b) => (b.eventDate > a.eventDate ? b : a));
  return {
    basis,
    sampleSize: used.length,
    ratio,
    suggestedQty: input.suggestedQty,
    adjustedQty: input.suggestedQty * (1 - ratio),
    unit: input.unit,
    last: { eventName: last.eventName, eventDate: last.eventDate, leftoverQty: last.leftoverQty },
  };
}
