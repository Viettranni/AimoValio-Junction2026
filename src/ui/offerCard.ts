// Display data for the Review screen's offer, approval and delivery cards. Pure, so it is unit-tested.
import type { DeliveryState, UiLang } from '@/contracts';
import type { Change, Offer, PolicyReason } from '@/gateway/types';
import { formatMoney } from './format';
import { t, type UiKey } from './i18n';
import { shortName } from './productName';

/** Time left on an offer, on the gateway's (demo) clock: browser now + skew. */
export function offerCountdown(validUntil: string, nowMs: number, skewMs = 0): { msLeft: number; expired: boolean; label: string } {
  const msLeft = Math.max(0, Date.parse(validUntil) - (nowMs + skewMs));
  const total = Math.ceil(msLeft / 1000);
  const label = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  return { msLeft, expired: msLeft <= 0, label };
}

/** "Rice €22.58 → €23.10": price changes per line, named from the offer. */
export function priceChanges(changes: Change[], offer: Offer, lang: UiLang): Array<{ lineId: string; name: string; text: string }> {
  return changes.filter((c) => c.field === 'price' && typeof c.from === 'number' && typeof c.to === 'number').map((c) => {
    const line = offer.lines.find((l) => l.lineId === c.lineId) ?? offer.lines.find((l) => l.productId === c.productId);
    const name = line ? shortName(line.productName) : (c.productId ?? '');
    return { lineId: c.lineId ?? c.productId ?? name, name, text: `${formatMoney(c.from as number, lang, 2)} → ${formatMoney(c.to as number, lang, 2)}` };
  });
}

const ROLE_KEYS: Record<string, UiKey> = { 'purchasing manager': 'role.purchasing_manager' };

export const roleLabel = (role: string, lang: UiLang) => {
  const key = ROLE_KEYS[role.trim().toLowerCase()];
  return key ? t(key, lang) : role;
};

/** Policy reasons in the buyer's language (the gateway's messages are English, for agents and the audit log). */
export function approvalReasons(reasons: PolicyReason[], ctx: { total: number; limitEur: number }, lang: UiLang): string[] {
  return [...new Set(reasons.map((r) => t(`rule.${r.rule}`, lang, {
    total: formatMoney(ctx.total, lang, 2), limit: formatMoney(ctx.limitEur, lang),
  })))];
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const deliveryStateLabel = (state: DeliveryState, lang: UiLang) => t(`delivery.${state}`, lang);
