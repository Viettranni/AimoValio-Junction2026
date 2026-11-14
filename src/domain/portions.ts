import type { EventType, MeasureUnit, PortionCategory } from '@/contracts';
import rulesJson from '../../data/portion-rules.json';

type Rule = { unit: MeasureUnit; perGuest: { default: number } & Partial<Record<EventType, number>> };
const rules = rulesJson as Record<PortionCategory, Rule>;

export function getPortion(category: PortionCategory, eventType: EventType): { amount: number; unit: MeasureUnit } {
  const rule = rules[category];
  return { amount: rule.perGuest[eventType] ?? rule.perGuest.default, unit: rule.unit };
}

export function requiredAmount(category: PortionCategory, eventType: EventType, guests: number): { amount: number; unit: MeasureUnit } {
  const { amount, unit } = getPortion(category, eventType);
  return { amount: amount * guests, unit };
}
