import type { CatalogProduct, PackPlan } from '@/contracts';

const EPSILON = 1e-9;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Rounds a required amount UP to whole orderable packs (multiples of allowedLotSize). */
export function packsFor(
  required: number,
  product: Pick<CatalogProduct, 'packSize' | 'packUnit' | 'allowedLotSize'>,
): PackPlan {
  const hasSize = product.packSize > 0;
  const size = hasSize ? product.packSize : 1;
  const unit = hasSize ? product.packUnit : 'pcs';
  const lot = Math.max(1, product.allowedLotSize);
  const lots = Math.max(0, Math.ceil(required / size / lot - EPSILON));
  const packs = lots * lot;
  return { packs, quantity: round6(packs * size), unit };
}
