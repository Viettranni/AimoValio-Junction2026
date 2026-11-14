import { describe, expect, it } from 'vitest';
import { defaultShortfall, toLeftoverQty } from './check-in';

describe('check-in parsing', () => {
  it('records "ran out" without an amount as a conservative shortfall (5% of ordered, to 0.5)', () => {
    expect(toLeftoverQty({ lineId: 'l-1', status: 'short', amount: null }, 54)).toBe(-2.5);
    expect(defaultShortfall(4)).toBe(0.5);
  });
  it('keeps given amounts with the right sign', () => {
    expect(toLeftoverQty({ lineId: 'l-1', status: 'short', amount: 3 }, 54)).toBe(-3);
    expect(toLeftoverQty({ lineId: 'l-1', status: 'short', amount: -3 }, 54)).toBe(-3);
    expect(toLeftoverQty({ lineId: 'l-1', status: 'left', amount: 5 }, 54)).toBe(5);
    expect(toLeftoverQty({ lineId: 'l-1', status: 'used_up', amount: null }, 54)).toBe(0);
  });
});
