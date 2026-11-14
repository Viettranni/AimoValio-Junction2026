/**
 * Fixture data for the widget's scripted demo mode, so the UI can be judged without a backend.
 * `applyFixtureChange` is a small local stand-in for the pure `applyDraftChange` in src/domain/draft.ts.
 */
import type {
  Allergen,
  AllergenCheck,
  CatalogProduct,
  ChoicesEvent,
  DietFlag,
  DietNeed,
  Draft,
  DraftChange,
  DraftDiff,
  DraftLine,
  DraftTotals,
  HistoryAdjustment,
  Intake,
  LineTag,
  MeasureUnit,
  MenuComponent,
  OrderSummary,
  PortionCategory,
  ProgressStepId,
  Receipt,
  Temperature,
} from '@/contracts';

const CUSTOMER_NAMES: Record<string, string> = { 'helsinki-juhlapalvelu': 'Helsinki Juhlapalvelu Oy' };

/** Display name for the buyer's company; unknown ids are shown as given. */
export function customerDisplayName(customerId: string): string {
  return CUSTOMER_NAMES[customerId] ?? customerId;
}
const VAT_RATE = 13.5;

interface FixtureProduct {
  id: string;
  name: string;
  packSize: number;
  unit: MeasureUnit;
  packDescription: string;
  price: number; // per pack, excl. VAT
  allergens: Allergen[] | 'unknown';
  dietFlags: DietFlag[];
  temperature: Temperature;
  terminal?: boolean; // supplier-delivered, stock not guaranteed
  reliability: number;
  co2PerKg: number | null;
}

const P = {
  chicken: { id: '6410405216213', name: 'Kariniemen Chicken breast fillet 4.4 kg', packSize: 4.4, unit: 'kg', packDescription: '4.4 kg bag', price: 43.12, allergens: [], dietFlags: ['gluten_free', 'lactose_free'], temperature: 'chilled', reliability: 0.98, co2PerKg: 4.6 },
  jasmine: { id: '8852111005015', name: 'Jasmine rice 5 kg', packSize: 5, unit: 'kg', packDescription: '5 kg bag', price: 11.9, allergens: [], dietFlags: ['gluten_free', 'lactose_free', 'vegan'], temperature: 'ambient', reliability: 0.97, co2PerKg: 2.7 },
  basmati: { id: '5011157630023', name: 'Tilda Basmati rice 5 kg', packSize: 5, unit: 'kg', packDescription: '5 kg bag', price: 14.6, allergens: [], dietFlags: ['gluten_free', 'lactose_free', 'vegan'], temperature: 'ambient', reliability: 0.99, co2PerKg: 2.7 },
  cream: { id: '6408430011574', name: 'Valio lactose-free cooking cream 15% 1 L', packSize: 1, unit: 'l', packDescription: '1 L carton', price: 2.85, allergens: ['milk'], dietFlags: ['lactose_free', 'gluten_free'], temperature: 'chilled', reliability: 0.99, co2PerKg: 2.9 },
  flour: { id: '6411200102215', name: 'Myllyn Paras wheat flour 2 kg', packSize: 2, unit: 'kg', packDescription: '2 kg bag', price: 2.15, allergens: ['gluten'], dietFlags: ['vegan'], temperature: 'ambient', reliability: 0.99, co2PerKg: 0.8 },
  gfFlour: { id: '7310100637019', name: 'Semper gluten-free flour mix 1 kg', packSize: 1, unit: 'kg', packDescription: '1 kg bag', price: 6.4, allergens: [], dietFlags: ['gluten_free', 'vegan'], temperature: 'ambient', reliability: 0.95, co2PerKg: 1.1 },
  bouillon: { id: '8714100877227', name: 'Knorr Professional chicken bouillon paste 1 kg', packSize: 1, unit: 'kg', packDescription: '1 kg tub', price: 9.4, allergens: ['celery'], dietFlags: ['gluten_free'], temperature: 'ambient', reliability: 0.98, co2PerKg: 3.2 },
  oil: { id: '6414893020052', name: 'Rapeseed oil 5 L', packSize: 5, unit: 'l', packDescription: '5 L can', price: 14.9, allergens: [], dietFlags: ['vegan', 'gluten_free', 'lactose_free'], temperature: 'ambient', reliability: 0.99, co2PerKg: 3.0 },
  salad: { id: '6430036840017', name: 'Iceberg & frisée salad mix 1 kg', packSize: 1, unit: 'kg', packDescription: '1 kg bag', price: 6.8, allergens: [], dietFlags: ['vegan', 'gluten_free', 'lactose_free'], temperature: 'chilled', reliability: 0.93, co2PerKg: 0.6 },
  tomato: { id: '6430036840116', name: 'Cherry tomatoes 1 kg', packSize: 1, unit: 'kg', packDescription: '1 kg box', price: 5.4, allergens: [], dietFlags: ['vegan', 'gluten_free', 'lactose_free'], temperature: 'chilled', reliability: 0.94, co2PerKg: 1.4 },
  rolls: { id: '6413467289108', name: 'Vaasan rye rolls, frozen 60 × 40 g', packSize: 60, unit: 'pcs', packDescription: 'box of 60', price: 13.9, allergens: ['gluten'], dietFlags: ['lactose_free', 'vegan'], temperature: 'frozen', reliability: 0.97, co2PerKg: 0.9 },
  gfRolls: { id: '6413467310208', name: 'Gluten-free bread rolls, frozen 24 pcs', packSize: 24, unit: 'pcs', packDescription: 'box of 24', price: 11.5, allergens: ['egg'], dietFlags: ['gluten_free', 'lactose_free'], temperature: 'frozen', reliability: 0.95, co2PerKg: 1.0 },
  butter: { id: '6408430000301', name: 'Valio butter, salted 500 g', packSize: 0.5, unit: 'kg', packDescription: '500 g pack', price: 3.95, allergens: ['milk'], dietFlags: ['gluten_free'], temperature: 'chilled', reliability: 0.99, co2PerKg: 9.0 },
  cake: { id: '6416796412003', name: 'Strawberry cream cake, frozen 24 slices', packSize: 24, unit: 'pcs', packDescription: '24-slice cake', price: 34.9, allergens: ['milk', 'egg', 'gluten'], dietFlags: [], temperature: 'frozen', terminal: true, reliability: 0.86, co2PerKg: 3.4 },
  coffee: { id: '6411300164557', name: 'Paulig Juhla Mokka coffee 500 g', packSize: 0.5, unit: 'kg', packDescription: '500 g pack', price: 6.95, allergens: [], dietFlags: ['vegan', 'gluten_free', 'lactose_free'], temperature: 'ambient', reliability: 0.99, co2PerKg: 8.0 },
  tea: { id: '8722700055433', name: 'Black tea bags 100 pcs', packSize: 100, unit: 'pcs', packDescription: 'box of 100', price: 4.2, allergens: [], dietFlags: ['vegan', 'gluten_free', 'lactose_free'], temperature: 'ambient', reliability: 0.99, co2PerKg: null },
  gravy: { id: '8714100661772', name: 'Knorr Professional brown gravy base 1.2 kg', packSize: 1.2, unit: 'kg', packDescription: '1.2 kg tub', price: 12.9, allergens: ['gluten', 'celery'], dietFlags: [], temperature: 'ambient', reliability: 0.97, co2PerKg: 2.1 },
} satisfies Record<string, FixtureProduct>;

type ProductKey = keyof typeof P;
const PRODUCTS_BY_ID = new Map<string, FixtureProduct>(Object.values(P).map((p) => [p.id, p]));

/** Product names that flicker past in the planning ticker. */
export const TICKER_NAMES = [
  'Kariniemen Chicken breast fillet 4.4 kg',
  'Atria chicken thigh fillet 2.5 kg',
  'Jasmine rice 5 kg',
  'Tilda Basmati rice 5 kg',
  'Parboiled long grain rice 10 kg',
  'Valio lactose-free cooking cream 15% 1 L',
  'Valio cooking cream 15% 1 L',
  'Semper gluten-free flour mix 1 kg',
  'Knorr Professional chicken bouillon paste 1 kg',
  'Rapeseed oil 5 L',
  'Myllyn Paras wheat flour 2 kg',
  'Saarioinen chicken fillet strips 2 kg',
];

// ───────────── Choice events (agent content, English in fixture mode) ─────────────

export const BUDGET_CHOICES: ChoicesEvent = {
  id: 'budget',
  question: 'Food budget, excl. VAT',
  options: [
    { id: '1000', label: '€1,000' },
    { id: '1500', label: '€1,500' },
    { id: '2000', label: '€2,000' },
    { id: 'none', label: 'No limit' },
  ],
  multi: false,
  allowFreeText: true,
};

export const DIET_CHOICES: ChoicesEvent = {
  id: 'diets',
  question: 'Allergies or special diets',
  options: [
    { id: 'none', label: 'No allergies' },
    { id: 'gluten_free', label: 'Gluten-free' },
    { id: 'lactose_free', label: 'Lactose-free' },
    { id: 'vegan', label: 'Vegan' },
    { id: 'nuts', label: 'Nut-free' },
  ],
  multi: true,
  allowFreeText: true,
};

export const ADDON_CHOICES: ChoicesEvent = {
  id: 'addons',
  question: 'Optional add-ons',
  options: [
    { id: 'salad', label: 'Salad' },
    { id: 'bread', label: 'Bread & butter' },
    { id: 'dessert', label: 'Dessert' },
    { id: 'coffee', label: 'Coffee & tea' },
    { id: 'gravy', label: 'Gravy' },
    { id: 'none', label: 'Just the mains' },
  ],
  multi: true,
  allowFreeText: true,
};

/** Guest counts assumed when a diet chip is tapped without a number; the assistant states them. */
export const DEMO_DIET_COUNTS: Record<string, number> = { gluten_free: 12, lactose_free: 4, vegan: 6, nuts: 3 };

export const WEDDING_INTAKE: Intake = {
  deliveryDate: '2026-12-06',
  guests: 300,
  menu: ['chicken', 'rice'],
  eventType: 'wedding',
  eventName: 'Wedding',
  lang: 'en',
};

export const CUTOFF = '2026-12-04T14:00:00+02:00';

export interface PlanningStep {
  step: ProgressStepId;
  ms: number;
  result: string;
  count?: number;
  ticker?: boolean;
}

export function planningScript(guests: number, dietGuests: number, lineCount: number): PlanningStep[] {
  return [
    { step: 'understand', ms: 520, result: `Wedding · ${guests} guests · chicken & rice` },
    { step: 'ingredients', ms: 640, result: `${lineCount} ingredients`, count: lineCount },
    { step: 'search', ms: 900, result: `${lineCount + 13} matching products`, count: lineCount + 13, ticker: true },
    { step: 'allergens', ms: 700, result: dietGuests ? `${dietGuests} special-diet guests covered` : 'No restrictions to check' },
    { step: 'prices', ms: 820, result: 'All deliverable · order by Fri 4 Dec 14:00' },
    { step: 'history', ms: 600, result: '2 notes from 3 past events', count: 2 },
    { step: 'draft', ms: 400, result: `${lineCount} lines ready`, count: lineCount },
  ];
}

// ───────────── Draft building ─────────────

interface ComponentTemplate {
  key: string;
  label: string;
  product: ProductKey;
  category: PortionCategory;
  origin: MenuComponent['origin'];
  perGuest: number; // in product unit
  dietVariant?: { of: string; diet: DietFlag };
  history?: Omit<HistoryAdjustment, 'suggestedQty' | 'adjustedQty' | 'unit'>;
}

const CORE: ComponentTemplate[] = [
  {
    key: 'chicken', label: 'Chicken', product: 'chicken', category: 'poultry_main', origin: 'requested', perGuest: 0.17,
    history: { basis: 'same_product', sampleSize: 3, ratio: 0.11, last: { eventName: 'Midsummer party', eventDate: '2026-06-19', leftoverQty: 6, guests: 280 } },
  },
  {
    key: 'rice', label: 'Rice', product: 'jasmine', category: 'grain_side', origin: 'requested', perGuest: 0.08,
    history: { basis: 'same_category_event', sampleSize: 3, ratio: -0.06, last: { eventName: 'Wedding', eventDate: '2026-08-08', leftoverQty: -2, guests: 220 } },
  },
  { key: 'cream', label: 'Cream sauce', product: 'cream', category: 'sauce', origin: 'needed_for_cooking', perGuest: 0.035 },
  { key: 'flour', label: 'Sauce thickener', product: 'flour', category: 'sauce', origin: 'needed_for_cooking', perGuest: 0.005 },
  { key: 'flour-gf', label: 'Sauce thickener, gluten-free', product: 'gfFlour', category: 'sauce', origin: 'needed_for_cooking', perGuest: 0.02, dietVariant: { of: 'flour', diet: 'gluten_free' } },
  { key: 'bouillon', label: 'Stock', product: 'bouillon', category: 'seasoning', origin: 'needed_for_cooking', perGuest: 0.003 },
  { key: 'oil', label: 'Cooking oil', product: 'oil', category: 'cooking_fat', origin: 'needed_for_cooking', perGuest: 0.01 },
];

const ADDONS: Record<string, ComponentTemplate[]> = {
  salad: [
    { key: 'salad', label: 'Green salad', product: 'salad', category: 'salad', origin: 'addon', perGuest: 0.03 },
    { key: 'tomato', label: 'Tomatoes', product: 'tomato', category: 'salad', origin: 'addon', perGuest: 0.02 },
  ],
  bread: [
    { key: 'rolls', label: 'Bread rolls', product: 'rolls', category: 'bread', origin: 'addon', perGuest: 1 },
    { key: 'rolls-gf', label: 'Bread rolls, gluten-free', product: 'gfRolls', category: 'bread', origin: 'addon', perGuest: 1, dietVariant: { of: 'rolls', diet: 'gluten_free' } },
    { key: 'butter', label: 'Butter', product: 'butter', category: 'dairy', origin: 'addon', perGuest: 0.01 },
  ],
  dessert: [{ key: 'cake', label: 'Cake', product: 'cake', category: 'dessert', origin: 'addon', perGuest: 1 }],
  coffee: [
    { key: 'coffee', label: 'Coffee', product: 'coffee', category: 'beverage', origin: 'addon', perGuest: 0.015 },
    { key: 'tea', label: 'Tea', product: 'tea', category: 'beverage', origin: 'addon', perGuest: 0.33 },
  ],
  gravy: [{ key: 'gravy', label: 'Gravy', product: 'gravy', category: 'sauce', origin: 'addon', perGuest: 0.005 }],
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const withTax = (n: number) => round2(n * (1 + VAT_RATE / 100));
const packsFor = (amount: number, packSize: number) => Math.max(1, Math.ceil(amount / packSize - 1e-9));

function dietGuestCount(diets: Intake['diets'], diet: DietFlag): number {
  if (!diets || diets === 'none') return 0;
  return diets.find((d) => d.diet === diet)?.guests ?? 0;
}

/** Fixture lines are chosen to fit the diets, and diet variants cover the restricted guests. */
function allergenCheckFor(product: FixtureProduct): AllergenCheck {
  return { productId: product.id, verdict: product.allergens === 'unknown' ? 'unknown' : 'pass', conflicts: [], unmetDiets: [] };
}

function tagsFor(product: FixtureProduct, template: ComponentTemplate): LineTag[] {
  const tags: LineTag[] = [product.terminal ? 'supplier_delivered' : 'in_stock'];
  if (product.reliability < 0.9) tags.push('may_deliver_short');
  if (template.dietVariant) tags.push('diet_variant');
  else if (template.origin === 'needed_for_cooking') tags.push('needed_for_cooking');
  else if (template.origin === 'addon') tags.push('addon');
  return tags;
}

/** Builds the wedding draft. Lines come back in display order, ready to be revealed one by one. */
export function buildFixtureDraft(intake: Intake, addonIds: string[], conversationId: string, customerId: string): Draft {
  const guests = intake.guests ?? 0;
  const templates = [...CORE, ...addonIds.flatMap((id) => ADDONS[id] ?? [])];
  const components: MenuComponent[] = [];
  const lines: DraftLine[] = [];

  for (const tpl of templates) {
    const product: FixtureProduct = P[tpl.product];
    const forGuests = tpl.dietVariant ? dietGuestCount(intake.diets, tpl.dietVariant.diet) : guests;
    if (forGuests === 0) continue;
    const requiredAmount = round2(tpl.perGuest * forGuests);
    const component: MenuComponent = {
      id: `c-${tpl.key}`,
      label: tpl.label,
      searchTerms: { fi: tpl.label, en: tpl.label },
      category: tpl.category,
      origin: tpl.origin,
      guests: forGuests,
      dietVariantOf: tpl.dietVariant ? `c-${tpl.dietVariant.of}` : undefined,
      requiredDiet: tpl.dietVariant ? [tpl.dietVariant.diet] : undefined,
      requiredAmount,
      requiredUnit: product.unit,
    };
    components.push(component);

    const suggestedPacks = packsFor(requiredAmount, product.packSize);
    const line: DraftLine = {
      id: `l-${tpl.key}`,
      componentId: component.id,
      group: tpl.category,
      productId: product.id,
      productName: product.name,
      packDescription: product.packDescription,
      packs: suggestedPacks,
      quantity: round2(suggestedPacks * product.packSize),
      unit: product.unit,
      unitPrice: product.price,
      unitPriceWithTax: withTax(product.price),
      tags: tagsFor(product, tpl),
      dietGuests: tpl.dietVariant ? forGuests : undefined,
      allergen: allergenCheckFor(product),
      alternatives: [],
    };
    if (tpl.history) line.history = historyFor(tpl.history, requiredAmount, product.packSize, product.unit, 'pending');
    lines.push(line);
  }

  const budget = typeof intake.budget === 'number' ? intake.budget : null;
  return {
    id: `d-${conversationId}`,
    conversationId,
    customerId,
    intake,
    components,
    lines,
    totals: computeFixtureTotals(lines, budget),
    cutoff: CUTOFF,
    status: 'ready',
    updatedAt: new Date().toISOString(),
  };
}

function historyFor(
  base: Omit<HistoryAdjustment, 'suggestedQty' | 'adjustedQty' | 'unit'>,
  requiredAmount: number,
  packSize: number,
  unit: MeasureUnit,
  choice: NonNullable<DraftLine['history']>['choice'],
): NonNullable<DraftLine['history']> {
  const adjustedQty = round2(requiredAmount * (1 - base.ratio));
  return {
    adjustment: { ...base, suggestedQty: requiredAmount, adjustedQty, unit },
    historyPacks: packsFor(adjustedQty, packSize),
    suggestedPacks: packsFor(requiredAmount, packSize),
    choice,
  };
}

export function computeFixtureTotals(lines: DraftLine[], budget: number | null): DraftTotals {
  let low = 0;
  let high = 0;
  let lowWithTax = 0;
  let highWithTax = 0;
  let pending = false;
  for (const line of lines) {
    if (line.unitPrice === null || line.unitPriceWithTax === null) continue;
    // A note whose history amount equals the suggestion has nothing to choose, so it never keeps the range open.
    const isPending = line.history?.choice === 'pending' && line.history.historyPacks !== line.history.suggestedPacks;
    pending ||= isPending;
    const lowPacks = isPending ? Math.min(line.history!.historyPacks, line.history!.suggestedPacks) : line.packs;
    const highPacks = isPending ? Math.max(line.history!.historyPacks, line.history!.suggestedPacks) : line.packs;
    low += line.unitPrice * lowPacks;
    high += line.unitPrice * highPacks;
    lowWithTax += line.unitPriceWithTax * lowPacks;
    highWithTax += line.unitPriceWithTax * highPacks;
  }
  return {
    low: round2(low),
    high: round2(high),
    lowWithTax: round2(lowWithTax),
    highWithTax: round2(highWithTax),
    collapsed: !pending,
    budget,
    overBudget: budget !== null && high > budget,
  };
}

// ───────────── Local draft changes ─────────────

const packSizeOf = (line: DraftLine) => (line.packs > 0 ? line.quantity / line.packs : 1);

function withPacks(line: DraftLine, packs: number, packSize = packSizeOf(line)): DraftLine {
  return { ...line, packs, quantity: round2(packs * packSize) };
}

const markUpdated = (line: DraftLine): DraftLine =>
  line.tags.includes('updated') ? line : { ...line, tags: [...line.tags, 'updated'] };

export function applyFixtureChange(draft: Draft, change: DraftChange): { draft: Draft; diff: DraftDiff } {
  const diff: DraftDiff = { changedLineIds: [], removedLineIds: [], addedLineIds: [] };
  // Only the latest edit keeps the "updated" tag.
  let lines = draft.lines.map((l) => (l.tags.includes('updated') ? { ...l, tags: l.tags.filter((t) => t !== 'updated') } : l));
  let components = draft.components;
  let intake = draft.intake;

  const update = (lineId: string, fn: (line: DraftLine) => DraftLine) => {
    lines = lines.map((l) => (l.id === lineId ? fn(l) : l));
    diff.changedLineIds.push(lineId);
  };

  switch (change.kind) {
    case 'setPacks':
      update(change.lineId, (l) => withPacks(l, Math.max(1, change.packs)));
      break;
    case 'historyChoice':
      update(change.lineId, (l) =>
        l.history
          ? withPacks(
              { ...l, history: { ...l.history, choice: change.choice } },
              change.choice === 'history' ? l.history.historyPacks : l.history.suggestedPacks,
            )
          : l,
      );
      break;
    case 'removeLine':
      lines = lines.filter((l) => l.id !== change.lineId);
      diff.removedLineIds.push(change.lineId);
      break;
    case 'addLine':
      lines = [...lines, change.line];
      diff.addedLineIds.push(change.line.id);
      break;
    case 'swapProduct':
      update(change.lineId, (l) => {
        const component = components.find((c) => c.id === l.componentId);
        const packs = component ? packsFor(component.requiredAmount, change.product.packSize) : l.packs;
        const history =
          l.history && component
            ? historyFor(l.history.adjustment, component.requiredAmount, change.product.packSize, change.product.packUnit, l.history.choice)
            : undefined;
        return markUpdated({
          ...withPacks(l, history?.choice === 'history' ? history.historyPacks : packs, change.product.packSize),
          productId: change.product.id,
          productName: change.product.nameEn,
          packDescription: change.product.packDescription,
          unit: change.product.packUnit,
          unitPrice: change.price?.price ?? null,
          unitPriceWithTax: change.price?.priceWithTax ?? null,
          tags: [...l.tags.filter((t) => t !== 'substitute'), 'substitute'],
          allergen: change.allergen,
          substituteFor: { productId: l.productId, productName: l.productName, reason: change.reason },
          history,
          price: change.price,
          availability: change.availability,
        });
      });
      break;
    case 'scaleGuests': {
      const from = intake.guests ?? change.guests;
      const factor = from > 0 ? change.guests / from : 1;
      components = components.map((c) =>
        c.dietVariantOf ? c : { ...c, guests: change.guests, requiredAmount: round2(c.requiredAmount * factor) },
      );
      intake = { ...intake, guests: change.guests };
      for (const line of lines) {
        const component = components.find((c) => c.id === line.componentId);
        if (!component || component.dietVariantOf) continue;
        const size = packSizeOf(line);
        const history = line.history ? historyFor(line.history.adjustment, component.requiredAmount, size, line.unit, line.history.choice) : undefined;
        const packs = history?.choice === 'history' ? history.historyPacks : packsFor(component.requiredAmount, size);
        if (packs !== line.packs) update(line.id, (l) => markUpdated({ ...withPacks(l, packs, size), history }));
        else if (history) lines = lines.map((l) => (l.id === line.id ? { ...l, history } : l));
      }
      break;
    }
  }

  const budget = typeof intake.budget === 'number' ? intake.budget : null;
  return {
    draft: { ...draft, intake, components, lines, totals: computeFixtureTotals(lines, budget), updatedAt: new Date().toISOString() },
    diff,
  };
}

// ───────────── Swaps ─────────────

function toCatalogProduct(p: FixtureProduct): CatalogProduct {
  return {
    id: p.id,
    nameEn: p.name,
    nameFi: p.name,
    category: '',
    salesUnit: '',
    salesUnitLabel: { en: 'pack', fi: 'pakkaus', sv: 'förpackning' },
    packSize: p.packSize,
    packUnit: p.unit,
    packDescription: p.packDescription,
    allowedLotSize: 1,
    temperature: p.temperature,
    vendor: '',
    allergens: p.allergens,
    ingredientData: p.allergens !== 'unknown',
    dietFlags: p.dietFlags,
    reliability: p.reliability,
    co2PerKg: p.co2PerKg,
  };
}

export function basmatiSwap(lineId: string): DraftChange {
  const p = P.basmati;
  const now = new Date().toISOString();
  return {
    kind: 'swapProduct',
    lineId,
    product: toCatalogProduct(p),
    price: { productId: p.id, ok: true, price: p.price, priceWithTax: withTax(p.price), taxRate: VAT_RATE, currency: 'EUR', fetchedAt: now },
    allergen: { productId: p.id, verdict: 'pass', conflicts: [], unmetDiets: [] },
    reason: 'You asked for basmati',
  };
}

// ───────────── Parsing typed answers (fixture only) ─────────────

const DIET_PATTERNS: Array<[string, RegExp]> = [
  ['gluten_free', /(\d+)\s*(?:x\s*)?(?:gluten[- ]?free|gluteenit\w*|glutenfri\w*|gf)\b/i],
  ['lactose_free', /(\d+)\s*(?:x\s*)?(?:lactose[- ]?free|laktoosit\w*|laktosfri\w*|lf)\b/i],
  ['vegan', /(\d+)\s*(?:x\s*)?(?:vegan\w*|vegaan\w*)/i],
  ['nuts', /(\d+)\s*(?:x\s*)?(?:nut[- ]?free|pähkinät\w*|nötfri\w*)/i],
];

export function parseFixtureAnswer(text: string): { budget?: number | 'none'; diets?: DietNeed[] | 'none' } {
  const result: { budget?: number | 'none'; diets?: DietNeed[] | 'none' } = {};
  if (/no (budget|limit)|ei budjet|ingen budget/i.test(text)) result.budget = 'none';
  const amount = '(\\d{1,3}(?:[,.\\s]\\d{3})+|\\d+)';
  const money = text.match(new RegExp(`€\\s?${amount}|${amount}\\s?(?:€|eur)`, 'i'));
  if (money) result.budget = Number((money[1] ?? money[2]).replace(/[,.\s]/g, ''));

  const diets: DietNeed[] = [];
  for (const [diet, re] of DIET_PATTERNS) {
    const m = text.match(re);
    if (m) diets.push({ diet: diet as DietNeed['diet'], guests: Number(m[1]) });
  }
  if (diets.length) result.diets = diets;
  else if (/no allerg|none|ei allerg|inga allerg/i.test(text)) result.diets = 'none';
  return result;
}

export function dietsFromChoice(ids: string[], freeText?: string): DietNeed[] | 'none' {
  const typed = freeText ? parseFixtureAnswer(freeText).diets : undefined;
  if (typed) return typed;
  if (ids.includes('none') || ids.length === 0) return 'none';
  return ids.map((id) => ({ diet: id as DietNeed['diet'], guests: DEMO_DIET_COUNTS[id] ?? 1 }));
}

export type FixtureEdit =
  | { kind: 'scale'; guests: number }
  | { kind: 'swapRice' }
  | { kind: 'remove'; lineId: string }
  | { kind: 'unknown' };

export function parseFixtureEdit(text: string, draft: Draft): FixtureEdit {
  const guests = text.match(/(\d{2,5})\s*(?:guests|pax|people|vierasta|hengelle|henkeä|gäster)/i);
  if (guests) return { kind: 'scale', guests: Number(guests[1]) };
  if (/basmati/i.test(text)) return { kind: 'swapRice' };
  const remove = text.match(/(?:remove|drop|poista|ta bort)\s+(?:the\s+)?(\w+)/i);
  if (remove) {
    const word = remove[1].toLowerCase();
    const line = draft.lines.find((l) => l.productName.toLowerCase().includes(word));
    if (line) return { kind: 'remove', lineId: line.id };
  }
  return { kind: 'unknown' };
}

export function detectFixtureLang(text: string): string {
  if (/\b(vierasta|häät|kanaa|riisiä|meillä|hengelle)\b/i.test(text)) return 'fi';
  if (/\b(gäster|bröllop|kyckling|vi har)\b/i.test(text)) return 'sv';
  return 'en';
}

// ───────────── Receipts and orders ─────────────

let orderCounter = 4817;

export function nextFixtureOrderId(): string {
  return `VA-2026-${String(orderCounter++).padStart(5, '0')}`;
}

export function fixtureReceipt(draft: Draft, orderId: string, submittedAt = new Date().toISOString()): Receipt {
  const lines = draft.lines
    .filter((l) => l.unitPrice !== null)
    .map((l) => ({
      lineId: l.id,
      productId: l.productId,
      productName: l.productName,
      packs: l.packs,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice!,
      unitPriceWithTax: l.unitPriceWithTax!,
      lineTotal: round2(l.unitPrice! * l.packs),
      lineTotalWithTax: round2(l.unitPriceWithTax! * l.packs),
    }));
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const totalWithTax = round2(lines.reduce((s, l) => s + l.lineTotalWithTax, 0));
  const co2 = lines.reduce((s, l) => {
    const p = PRODUCTS_BY_ID.get(l.productId);
    return p?.co2PerKg && l.unit !== 'pcs' ? s + p.co2PerKg * l.quantity : s;
  }, 0);
  return {
    orderId,
    simulated: true,
    customerId: draft.customerId,
    eventName: draft.intake.eventName ?? 'Event',
    eventType: draft.intake.eventType ?? 'other',
    deliveryDate: draft.intake.deliveryDate ?? '',
    guests: draft.intake.guests ?? 0,
    lines,
    total,
    totalWithTax,
    vat: round2(totalWithTax - total),
    co2Kg: Math.round(co2),
    minutesSaved: 40,
    submittedAt,
  };
}

interface PastOrder {
  summary: OrderSummary;
  intake: Intake;
  items: Array<[ProductKey, number]>;
}

const PAST: PastOrder[] = [
  {
    summary: { orderId: 'VA-2026-03187', eventName: 'Wedding', eventDate: '2026-08-08', guests: 220, total: 0, submittedAt: '2026-07-29T09:12:00+03:00', leftoverRatio: -0.03, checkInDone: true },
    intake: { eventName: 'Wedding', eventType: 'wedding', deliveryDate: '2026-08-08', guests: 220 },
    items: [['chicken', 9], ['jasmine', 3], ['cream', 8], ['salad', 7], ['rolls', 4], ['butter', 4]],
  },
  {
    summary: { orderId: 'VA-2026-02544', eventName: 'Midsummer party', eventDate: '2026-06-19', guests: 280, total: 0, submittedAt: '2026-06-10T13:40:00+03:00', leftoverRatio: 0.08, checkInDone: true },
    intake: { eventName: 'Midsummer party', eventType: 'party', deliveryDate: '2026-06-19', guests: 280 },
    items: [['chicken', 12], ['jasmine', 5], ['cream', 10], ['salad', 9], ['tomato', 6], ['coffee', 8]],
  },
  {
    summary: { orderId: 'VA-2026-01902', eventName: 'Corporate lunch', eventDate: '2026-03-12', guests: 90, total: 0, submittedAt: '2026-03-05T10:05:00+02:00', leftoverRatio: 0.12, checkInDone: true },
    intake: { eventName: 'Corporate lunch', eventType: 'corporate_lunch', deliveryDate: '2026-03-12', guests: 90 },
    items: [['chicken', 4], ['basmati', 2], ['cream', 3], ['salad', 3]],
  },
  {
    summary: { orderId: 'VA-2025-09902', eventName: 'Christmas party', eventDate: '2025-12-12', guests: 160, total: 0, submittedAt: '2025-12-02T15:22:00+02:00', leftoverRatio: 0.06, checkInDone: true },
    intake: { eventName: 'Christmas party', eventType: 'party', deliveryDate: '2025-12-12', guests: 160 },
    items: [['chicken', 7], ['jasmine', 3], ['gravy', 1], ['cake', 7], ['coffee', 5]],
  },
];

/** Past orders for "My orders", with receipts whose totals match their lines. */
export function fixturePastOrders(customerId: string): Array<{ summary: OrderSummary; receipt: Receipt }> {
  return PAST.map(({ summary, intake, items }) => {
    const lines: DraftLine[] = items.map(([key, packs]) => {
      const p: FixtureProduct = P[key];
      return {
        id: `l-${key}`, componentId: `c-${key}`, group: 'poultry_main', productId: p.id, productName: p.name,
        packDescription: p.packDescription, packs, quantity: round2(packs * p.packSize), unit: p.unit,
        unitPrice: p.price, unitPriceWithTax: withTax(p.price), tags: [],
        allergen: { productId: p.id, verdict: 'pass', conflicts: [], unmetDiets: [] }, alternatives: [],
      };
    });
    const draft = { customerId, intake, lines } as Pick<Draft, 'customerId' | 'intake' | 'lines'> as Draft;
    const receipt = fixtureReceipt(draft, summary.orderId, summary.submittedAt);
    return { summary: { ...summary, total: receipt.total }, receipt };
  });
}

// ───────────── Check-in (fixture only) ─────────────

export interface CheckInResult {
  lineId: string;
  productName: string;
  outcome: 'left' | 'short';
  amount: number | null;
  unit: MeasureUnit;
}

const GENERIC_WORDS = new Set(['frozen', 'pack', 'slices', 'with', 'professional', 'kariniemen', 'valio']);

function keywordsOf(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-zåäö-]+/)
    .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
}

/** Reads "about 5 kg chicken left, rice ran out" into per-line outcomes. Unmentioned lines count as used up. */
export function parseFixtureCheckIn(
  text: string,
  lines: Array<{ lineId: string; productName: string; quantity: number; unit: MeasureUnit }>,
): { results: CheckInResult[]; ratio: number } {
  const results: CheckInResult[] = [];
  for (const segment of text.toLowerCase().split(/,|;|\band\b|\bja\b|\boch\b/)) {
    const line = lines.find((l) => keywordsOf(l.productName).some((k) => segment.includes(k)));
    if (!line || results.some((r) => r.lineId === line.lineId)) continue;
    const short = /ran out|run out|short|loppui|vajaa|tog slut|fattades/.test(segment);
    const left = /left|over|jäi|blev/.test(segment);
    if (!short && !left) continue;
    const amount = segment.match(/(\d+(?:[.,]\d+)?)/);
    results.push({
      lineId: line.lineId,
      productName: line.productName,
      outcome: short ? 'short' : 'left',
      amount: amount ? Number(amount[1].replace(',', '.')) : null,
      unit: line.unit,
    });
  }
  const measured = lines.filter((l) => l.unit !== 'pcs').reduce((s, l) => s + l.quantity, 0);
  const signed = results.reduce((s, r) => s + (r.amount ?? 0) * (r.outcome === 'left' ? 1 : -1), 0);
  return { results, ratio: measured > 0 ? round2(signed / measured) : 0 };
}
