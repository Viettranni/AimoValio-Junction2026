import type {
  CatalogProduct, Draft, DraftChange, DraftDiff, DraftLine, MenuComponent,
} from '@/contracts';
import { effectiveCutoff } from './cutoff';
import { requiredAmount } from './portions';
import { packsFor } from './quantities';
import { computeTotals } from './totals';

interface Ctx { getProduct(id: string): CatalogProduct | undefined }

const withTag = (line: DraftLine): DraftLine =>
  line.tags.includes('updated') ? line : { ...line, tags: [...line.tags, 'updated'] };
const withoutTag = (line: DraftLine): DraftLine =>
  line.tags.includes('updated') ? { ...line, tags: line.tags.filter((t) => t !== 'updated') } : line;

/** Units per pack, from the catalogue when known, else inferred from the line itself. */
function packSizeOf(line: DraftLine, ctx: Ctx): number {
  const fromCatalog = ctx.getProduct(line.productId)?.packSize;
  if (fromCatalog && fromCatalog > 0) return fromCatalog;
  return line.packs > 0 ? line.quantity / line.packs : 1;
}

function withPacks(line: DraftLine, packs: number, size: number): DraftLine {
  return { ...line, packs, quantity: Math.round(packs * size * 1e6) / 1e6 };
}

export function applyDraftChange(draft: Draft, change: DraftChange, ctx: Ctx): { draft: Draft; diff: DraftDiff } {
  const diff: DraftDiff = { changedLineIds: [], removedLineIds: [], addedLineIds: [] };
  let lines = draft.lines;
  let components = draft.components;
  let intake = draft.intake;

  switch (change.kind) {
    case 'setPacks':
      lines = lines.map((l) => {
        if (l.id !== change.lineId) return l;
        diff.changedLineIds.push(l.id);
        const lot = Math.max(1, ctx.getProduct(l.productId)?.allowedLotSize ?? 1);
        const packs = Math.max(0, Math.ceil(change.packs / lot) * lot);
        const next = withPacks(l, packs, packSizeOf(l, ctx));
        // A manual choice wins over a pending history note, which collapses.
        return next.history?.choice === 'pending' ? { ...next, history: { ...next.history, choice: 'suggested' } } : next;
      });
      break;
    case 'historyChoice':
      lines = lines.map((l) => {
        if (l.id !== change.lineId || !l.history) return l;
        diff.changedLineIds.push(l.id);
        const packs = change.choice === 'history' ? l.history.historyPacks : l.history.suggestedPacks;
        return { ...withPacks(l, packs, packSizeOf(l, ctx)), history: { ...l.history, choice: change.choice } };
      });
      break;
    case 'removeLine':
      diff.removedLineIds = lines.filter((l) => l.id === change.lineId).map((l) => l.id);
      lines = lines.filter((l) => l.id !== change.lineId);
      break;
    case 'addLine':
      diff.addedLineIds.push(change.line.id);
      lines = [...lines, change.line];
      break;
    case 'swapProduct':
      lines = lines.map((l) => (l.id === change.lineId ? (diff.changedLineIds.push(l.id), swap(l, change, draft.components)) : l));
      break;
    case 'scaleGuests': {
      const scaled = scaleGuests(draft, change.guests, ctx);
      ({ lines, components, intake } = scaled);
      diff.changedLineIds = scaled.changedLineIds;
      break;
    }
  }

  const touched = new Set([...diff.changedLineIds, ...diff.addedLineIds]);
  lines = lines.map((l) => (touched.has(l.id) ? withTag(l) : withoutTag(l)));
  const closings = lines.map((l) => (l.availability ? effectiveCutoff(l.availability, intake.deliveryDate ?? '') : null)).filter((t): t is string => !!t).sort((a, b) => Date.parse(a) - Date.parse(b));

  return {
    draft: { ...draft, intake, components, lines, totals: computeTotals(lines, intake.budget), cutoff: closings[0] ?? null },
    diff,
  };
}

function swap(line: DraftLine, change: Extract<DraftChange, { kind: 'swapProduct' }>, components: MenuComponent[]): DraftLine {
  const { product, price, availability, allergen, reason } = change;
  const component = components.find((c) => c.id === line.componentId);
  const plan = packsFor(component?.requiredAmount ?? line.quantity, product);
  const { history: _dropped, ...rest } = line;
  return {
    ...rest,
    productId: product.id,
    productName: product.nameEn,
    packDescription: product.packDescription,
    packs: plan.packs,
    quantity: plan.quantity,
    unit: plan.unit,
    unitPrice: price?.price ?? null,
    unitPriceWithTax: price?.priceWithTax ?? null,
    tags: [...line.tags.filter((t) => t !== 'substitute'), 'substitute'],
    allergen,
    substituteFor: { productId: line.productId, productName: line.productName, reason },
    availability,
    price,
  };
}

function scaleGuests(draft: Draft, guests: number, ctx: Ctx) {
  const oldGuests = draft.intake.guests ?? 0;
  const ratio = oldGuests > 0 ? guests / oldGuests : 1;
  const eventType = draft.intake.eventType ?? 'other';

  const components = draft.components.map((c) => {
    const compGuests = c.dietVariantOf ? Math.min(c.guests, guests) : Math.round(c.guests * ratio);
    const { amount } = requiredAmount(c.category, eventType, compGuests);
    return { ...c, guests: compGuests, requiredAmount: amount };
  });

  const changedLineIds: string[] = [];
  const lines = draft.lines.map((l) => {
    const component = components.find((c) => c.id === l.componentId);
    if (!component) return l;
    const size = packSizeOf(l, ctx);
    const product = ctx.getProduct(l.productId) ?? { packSize: size, packUnit: l.unit, allowedLotSize: 1 };
    const suggested = packsFor(component.requiredAmount, product);
    let next: DraftLine = withPacks(l, suggested.packs, size);
    if (l.history) {
      const adjustedQty = l.history.adjustment.adjustedQty * ratio;
      const historyPacks = packsFor(adjustedQty, product).packs;
      const { choice } = l.history;
      const packs = choice === 'history' ? historyPacks : suggested.packs;
      next = {
        ...withPacks(l, packs, size),
        history: {
          ...l.history,
          historyPacks,
          suggestedPacks: suggested.packs,
          adjustment: { ...l.history.adjustment, suggestedQty: component.requiredAmount, adjustedQty },
        },
      };
    }
    if (next.packs !== l.packs) changedLineIds.push(l.id);
    return next;
  });

  return { components, lines, intake: { ...draft.intake, guests }, changedLineIds };
}
