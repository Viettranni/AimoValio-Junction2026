import type { MeasureUnit } from '@/contracts';

interface RawUnitFields {
  salesUnit: string;
  baseUnit: string;
  allowedLotSize?: number;
  units?: Array<{ unitId: string; sizeInBaseUnits: number }>;
  synkkaData?: {
    names?: Array<{ value: string; language: string }>;
    unitConversions?: Array<{
      synkkaPackagingType: string;
      netWeight?: { unit: string; value: number };
    }>;
  };
}

export interface DerivedUnits {
  salesUnitLabel: { en: string; fi: string; sv: string };
  packSize: number;
  packUnit: MeasureUnit;
  packDescription: string;
}

const LABELS: Record<string, { en: string; fi: string; sv: string }> = {
  KI: { en: 'box', fi: 'laatikko', sv: 'kartong' },
  ST: { en: 'piece', fi: 'kpl', sv: 'st' },
  KG: { en: 'kg', fi: 'kg', sv: 'kg' },
  PAK: { en: 'pack', fi: 'pakkaus', sv: 'förpackning' },
  BAG: { en: 'bag', fi: 'pussi', sv: 'påse' },
  RAS: { en: 'tub', fi: 'rasia', sv: 'ask' },
  PRK: { en: 'tub', fi: 'purkki', sv: 'burk' },
  BOT: { en: 'bottle', fi: 'pullo', sv: 'flaska' },
  SK: { en: 'sack', fi: 'säkki', sv: 'säck' },
  CS: { en: 'case', fi: 'kotelo', sv: 'kartong' },
};
const FALLBACK_LABEL = { en: 'package', fi: 'pakkaus', sv: 'förpackning' };

const TO_BASE: Record<string, { factor: number; kind: 'kg' | 'l' }> = {
  kg: { factor: 1, kind: 'kg' }, g: { factor: 0.001, kind: 'kg' },
  l: { factor: 1, kind: 'l' }, dl: { factor: 0.1, kind: 'l' },
  cl: { factor: 0.01, kind: 'l' }, ml: { factor: 0.001, kind: 'l' },
};
const NET_WEIGHT_KG: Record<string, number> = { KGM: 1, GRM: 0.001 };

interface NameMeasure { kind: 'kg' | 'l'; perItem: number; count: number | null; total: number }

/** Largest measure in a product name: "4x1,5kg", "10 kg", "1 L", "appr. 4,4 kg", "6 x Filos feta 750g". */
export function parseNameMeasure(name: string): NameMeasure | null {
  const leading = /^\s*(\d+)\s*[x×]\s*/i.exec(name);
  const trailing = /[x×]\s*(\d+)\s*(?:pcs|kpl|st)?\s*$/i.exec(name);
  const leadCount = leading ? Number(leading[1]) : trailing ? Number(trailing[1]) : null;
  const re = /(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|ml|cl|dl|g|l)(?![a-zäöå])/gi;
  let best: NameMeasure | null = null;
  for (const m of name.matchAll(re)) {
    const unit = TO_BASE[m[3].toLowerCase()];
    const perItem = Number(m[2].replace(',', '.')) * unit.factor;
    const count = m[1] ? Number(m[1]) : leadCount;
    const total = perItem * (count ?? 1);
    if (!(total > 0)) continue;
    if (!best || total > best.total) best = { kind: unit.kind, perItem, count, total };
  }
  return best;
}

function dataNetKg(raw: RawUnitFields, sizeOfSalesUnit: number): number | null {
  const conv = raw.synkkaData?.unitConversions ?? [];
  const kg = (type: string) => {
    const w = conv.find((c) => c.synkkaPackagingType === type)?.netWeight;
    const f = w ? NET_WEIGHT_KG[w.unit] : undefined;
    return w && f && w.value > 0 ? w.value * f : null;
  };
  const each = kg('BASE_UNIT_OR_EACH');
  if (raw.salesUnit === raw.baseUnit) return each ?? kg('CASE');
  // CASE net weight describes the whole sales unit; an EACH weight must be scaled up.
  return kg('CASE') ?? (each !== null ? each * sizeOfSalesUnit : null);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function fmt(size: number, unit: MeasureUnit): string {
  if (unit === 'kg') return size < 1 ? `${round(size * 1000)} g` : `${round(size)} kg`;
  if (unit === 'l') return size < 1 ? `${round(size * 1000)} ml` : `${round(size)} l`;
  return `${round(size)} pcs`;
}

export function deriveUnits(raw: RawUnitFields): DerivedUnits {
  const salesUnitLabel = LABELS[raw.salesUnit] ?? FALLBACK_LABEL;
  const label = salesUnitLabel.en;
  const names = raw.synkkaData?.names ?? [];
  const name = names.find((n) => n.language === 'en')?.value ?? names[0]?.value ?? '';
  const measure = parseNameMeasure(name);
  const sizeOfSalesUnit = raw.units?.find((u) => u.unitId === raw.salesUnit)?.sizeInBaseUnits ?? 1;
  const multiPiece = raw.salesUnit !== raw.baseUnit && sizeOfSalesUnit > 1;

  // Sold loose by weight (price per kg): the name's approximate weight is the practical pack.
  if (raw.salesUnit === 'KG') {
    const size = measure?.kind === 'kg' ? round(measure.total) : 1;
    return { salesUnitLabel, packSize: size, packUnit: 'kg', packDescription: measure ? `approx. ${fmt(size, 'kg')} (sold by kg)` : 'sold by kg' };
  }

  // The name either states the case ("4x1,5kg", "400g x 6") or just one item ("45cl"):
  // a count matching the sales unit's size is the case; a bare item scales by that size.
  let multiplier = 1;
  let each = measure?.perItem ?? 0;
  if (measure) {
    if (measure.count !== null && (!multiPiece || measure.count === sizeOfSalesUnit)) multiplier = measure.count;
    else if (multiPiece) { multiplier = sizeOfSalesUnit; each = measure.count !== null ? measure.total : measure.perItem; }
  }
  const nameTotal = measure ? each * multiplier : null;
  const describe = (size: number, unit: MeasureUnit) =>
    measure && multiplier > 1 && Math.abs(each * multiplier - size) < size * 0.02
      ? `${multiplier} × ${unit === 'l' ? `${round(each)} l` : fmt(each, unit)} ${label}`
      : `${fmt(size, unit)} ${label}`;

  const dataKg = dataNetKg(raw, sizeOfSalesUnit);
  if (measure?.kind === 'l' && nameTotal) {
    const size = round(nameTotal);
    return { salesUnitLabel, packSize: size, packUnit: 'l', packDescription: describe(size, 'l') };
  }
  const kgSize = dataKg ?? (measure?.kind === 'kg' ? nameTotal : null);
  if (kgSize) {
    const size = round(kgSize);
    return { salesUnitLabel, packSize: size, packUnit: 'kg', packDescription: describe(size, 'kg') };
  }
  if (raw.baseUnit === 'KG') {
    return { salesUnitLabel, packSize: sizeOfSalesUnit, packUnit: 'kg', packDescription: `${fmt(sizeOfSalesUnit, 'kg')} ${label}` };
  }
  const pcs = multiPiece ? sizeOfSalesUnit : 1;
  return { salesUnitLabel, packSize: pcs, packUnit: 'pcs', packDescription: pcs > 1 ? `${pcs} pcs ${label}` : `1 ${label}` };
}
