import { describe, expect, it } from 'vitest';
import type { ProgressEvent } from '@/contracts';
import {
  activeStep, interleave, parseSampleQuery, mixGroups, productsFromNames, rollIndex, runFinished, sampleTerms, scramblePrice, shelfGroup,
  shelfModeFor, showShelfCard, supplierLabel, termsKey, throttleOpen, throttleWait, tickerOf, toolRunning, uniqueByName,
} from './shelf';

const ev = (step: ProgressEvent['step'], status: ProgressEvent['status'], extra: Partial<ProgressEvent> = {}): ProgressEvent => ({
  step, status, label: step, ...extra,
});

describe('shelfGroup', () => {
  it.each([
    ['Kariniemen Chicken breast fillet 4.4 kg', 'poultry'],
    ['Broileri ohutleike 1 kg', 'poultry'],
    ['Jasmine rice 5 kg', 'grains'],
    ['Vaasan rye rolls, frozen 60 × 40 g', 'grains'],
    ['Valio cooking cream 15% 1 L', 'dairy'],
    ['Valio butter, salted 500 g', 'dairy'],
    ['Cherry tomatoes 1 kg', 'veg'],
    ['Iceberg & frisée salad mix 1 kg', 'veg'],
    ['Rapeseed oil 5 L', 'pantry'],
    ['Knorr Professional chicken bouillon paste 1 kg', 'pantry'],
    ['Rypsiöljy 10 l', 'pantry'],
    ['Paper napkins 33 cm', 'generic'],
  ] as const)('%s → %s', (name, group) => expect(shelfGroup(name)).toBe(group));
});

describe('supplierLabel', () => {
  it('drops legal and warehouse words and fixes the caps', () => {
    expect(supplierLabel('ATRIA SUOMI OY TUORE')).toBe('Atria Suomi');
    expect(supplierLabel('DUNI OY, PROFESSIONAL')).toBe('Duni');
    expect(supplierLabel('BUD HOLLAND B.V.')).toBe('Bud Holland');
    expect(supplierLabel('VALIO OY TUORE')).toBe('Valio');
  });
  it('gives nothing for missing or unusable names', () => {
    expect(supplierLabel(undefined)).toBeUndefined();
    expect(supplierLabel('OY')).toBeUndefined();
  });
});

describe('sampleTerms', () => {
  it('normalises, deduplicates and sorts the menu chips', () => {
    expect(sampleTerms({ menu: ['Rice', 'chicken!', 'rice', ' Salmon  fillet '] })).toEqual(['chicken', 'rice', 'salmon fillet']);
  });
  it('is empty without a menu, which means the staples', () => {
    expect(sampleTerms(null)).toEqual([]);
    expect(sampleTerms({})).toEqual([]);
    expect(termsKey([])).toBe('');
  });
  it('reads the endpoint query as dishes or words', () => {
    expect(parseSampleQuery('chicken rice')).toEqual(['chicken', 'rice']);
    expect(parseSampleQuery('salmon fillet, potato')).toEqual(['potato', 'salmon fillet']);
    expect(parseSampleQuery('')).toEqual([]);
  });
  it('gives the same key for the same menu in any order', () => {
    expect(termsKey(sampleTerms({ menu: ['rice', 'chicken'] }))).toBe(termsKey(sampleTerms({ menu: ['chicken', 'rice'] })));
  });
});

describe('sampling helpers', () => {
  it('interleaves lists round-robin', () => {
    expect(interleave<string | number>([[1, 2, 3], ['a'], [10, 20]])).toEqual([1, 'a', 10, 2, 20, 3]);
  });
  it('keeps the first of each name', () => {
    expect(uniqueByName([{ displayName: 'Rice' }, { displayName: 'rice' }, { displayName: 'Oil' }])).toEqual([
      { displayName: 'Rice' },
      { displayName: 'Oil' },
    ]);
  });
  it('spreads groups through the roll', () => {
    const mixed = mixGroups(productsFromNames(['Chicken a', 'Chicken b', 'Rice a', 'Chicken c', 'Rice b']));
    expect(mixed.map((p) => p.displayName)).toEqual(['Chicken a', 'Rice a', 'Chicken b', 'Rice b', 'Chicken c']);
  });
  it('cycles indexes with offsets and survives empty lists', () => {
    expect(rollIndex(0, 4)).toBe(0);
    expect(rollIndex(5, 4)).toBe(1);
    expect(rollIndex(5, 4, 2)).toBe(3);
    expect(rollIndex(3, 0)).toBe(0);
  });
  it('scrambles price-shaped text deterministically', () => {
    expect(scramblePrice(3)).toBe(scramblePrice(3));
    expect(scramblePrice(3)).not.toBe(scramblePrice(4));
    expect(scramblePrice(9, 2)).toMatch(/^\d{1,2},\d{2}$/);
  });
});

describe('throttle', () => {
  it('lets the first update through and holds later ones for the window', () => {
    expect(throttleOpen(null, 0, 2000)).toBe(true);
    expect(throttleOpen(1000, 2500, 2000)).toBe(false);
    expect(throttleOpen(1000, 3000, 2000)).toBe(true);
    expect(throttleWait(null, 0, 2000)).toBe(0);
    expect(throttleWait(1000, 2500, 2000)).toBe(500);
    expect(throttleWait(1000, 9000, 2000)).toBe(0);
  });
});

describe('planning progress', () => {
  const run = [ev('understand', 'start'), ev('understand', 'done'), ev('search', 'start'), ev('search', 'done', { ticker: ['A', 'B'] })];

  it('finds the step that is running', () => {
    expect(activeStep([])).toBeNull();
    expect(activeStep(run.slice(0, 3))).toBe('search');
    expect(activeStep(run)).toBeNull();
  });
  it('maps steps to rolls and carries the search ticker forward', () => {
    expect(shelfModeFor('search')).toBe('search');
    expect(shelfModeFor('prices')).toBe('prices');
    expect(shelfModeFor('allergens')).toBe('allergens');
    expect(shelfModeFor('history')).toBeNull();
    expect(tickerOf(run)).toEqual(['A', 'B']);
    expect(tickerOf(run.slice(0, 3))).toBeUndefined();
  });
  it('shows the shelf card in quiet gaps, not over a rolling step or a streaming reply', () => {
    expect(showShelfCard({ events: [], replyText: '' })).toBe(true);
    expect(showShelfCard({ events: [], replyText: 'Sure' })).toBe(false);
    expect(showShelfCard({ events: run.slice(0, 3), replyText: '' })).toBe(false);
    expect(showShelfCard({ events: run, replyText: 'Let me plan that.' })).toBe(true);
    const done = [...run, ev('draft', 'start'), ev('draft', 'done')];
    expect(runFinished(done)).toBe(true);
    expect(showShelfCard({ events: done, replyText: 'Your draft is ready' })).toBe(false);
  });
});

describe('toolRunning', () => {
  it('is true from the call until the result', () => {
    expect(toolRunning([{ type: 'tool-editDraft', state: 'input-available' }], 'editDraft')).toBe(true);
    expect(toolRunning([{ type: 'dynamic-tool', toolName: 'editDraft', state: 'input-streaming' }], 'editDraft')).toBe(true);
    expect(toolRunning([{ type: 'tool-editDraft', state: 'output-available' }], 'editDraft')).toBe(false);
    expect(toolRunning([{ type: 'tool-planOrder', state: 'input-available' }], 'editDraft')).toBe(false);
    expect(toolRunning(undefined, 'editDraft')).toBe(false);
  });
});
