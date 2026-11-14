import { describe, expect, it } from 'vitest';
import { getPortion, requiredAmount } from './portions';

describe('portions', () => {
  it('uses the event-specific amount when present', () => {
    expect(getPortion('poultry_main', 'wedding')).toEqual({ amount: 0.2, unit: 'kg' });
  });
  it('falls back to default', () => {
    expect(getPortion('poultry_main', 'school')).toEqual({ amount: 0.18, unit: 'kg' });
  });
  it('scales by guests', () => {
    const r = requiredAmount('grain_side', 'party', 300);
    expect(r.amount).toBeCloseTo(24);
    expect(r.unit).toBe('kg');
  });
});
