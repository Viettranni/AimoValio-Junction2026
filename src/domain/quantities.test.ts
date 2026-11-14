import { describe, expect, it } from 'vitest';
import { packsFor } from './quantities';

describe('packsFor', () => {
  it('rounds up to whole packs', () => {
    expect(packsFor(47.2, { packSize: 6, packUnit: 'kg', allowedLotSize: 1 })).toEqual({ packs: 8, quantity: 48, unit: 'kg' });
  });
  it('does not add a pack on exact fit', () => {
    expect(packsFor(48, { packSize: 6, packUnit: 'kg', allowedLotSize: 1 }).packs).toBe(8);
  });
  it('respects allowedLotSize', () => {
    expect(packsFor(13, { packSize: 2, packUnit: 'kg', allowedLotSize: 4 })).toEqual({ packs: 8, quantity: 16, unit: 'kg' });
  });
  it('treats packSize 0 as 1 pcs', () => {
    expect(packsFor(3.2, { packSize: 0, packUnit: 'kg', allowedLotSize: 1 })).toEqual({ packs: 4, quantity: 4, unit: 'pcs' });
  });
});
