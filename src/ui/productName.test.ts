import { describe, expect, it } from 'vitest';
import { displayName, shortName } from './productName';

describe('product display names', () => {
  it('turns all-caps names into sentence case and drops a trailing country code', () => {
    expect(displayName('MIXED LETTUCE FI')).toBe('Mixed lettuce');
    expect(displayName('Basmati rice 5kg')).toBe('Basmati rice 5kg');
    expect(displayName('Jäävuorisalaatti FI')).toBe('Jäävuorisalaatti');
  });
  it('shortens long names before the first size/spec token', () => {
    expect(shortName('Top Choice poultry Chicken breast fillet 130-150g wo.inners skinless boneless un-cal. chilled 5kg'))
      .toBe('Top Choice poultry Chicken breast fillet');
    expect(shortName('Broileri rintafilee n4,4kg')).toBe('Broileri rintafilee');
    expect(shortName('Rice 5kg')).toBe('Rice 5kg');
    expect(shortName('Very long product name without any numbers that goes on and on forever')).toMatch(/…$/);
    expect(shortName('Very long product name without any numbers that goes on and on forever').length).toBeLessThanOrEqual(43);
  });
});
