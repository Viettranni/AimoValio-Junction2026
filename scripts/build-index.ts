import { readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CatalogProduct, Temperature } from '../src/contracts';
import { deriveAllergens, deriveDietFlags, looksLikeIngredientList } from '../src/catalog/allergens';
import { deriveUnits } from '../src/catalog/units';

const RAW = path.join(process.cwd(), 'data', 'raw');
const OUT = path.join(process.cwd(), 'data', 'catalog.index.json');

type Localized = Array<{ value: string; language: string }>;
interface RawProduct {
  id: string;
  salesUnit: string;
  baseUnit: string;
  category: string;
  allowedLotSize: number;
  deleted: boolean;
  temperatureCondition?: number;
  vendorName?: string;
  units?: Array<{ unitId: string; sizeInBaseUnits: number }>;
  synkkaData?: {
    names?: Localized;
    keyIngredients?: Localized;
    ingredients?: Array<{ names?: Localized }>;
    unitConversions?: Array<{ synkkaPackagingType: string; netWeight?: { unit: string; value: number } }>;
  };
}

// Condition codes inferred from product names: 7 is 100% frozen items; 8 is shelf-stable;
// 1-5 are meat/dairy/produce coolers. 6 and 9 are mixed bags, so they stay unknown.
function temperature(code: number | undefined): Temperature {
  if (code === 7) return 'frozen';
  if (code === 8) return 'ambient';
  if (code !== undefined && [1, 2, 3, 4, 5].includes(code)) return 'chilled';
  return 'unknown';
}

function readCsv(file: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of readFileSync(path.join(RAW, file), 'utf8').split(/\r?\n/).slice(1)) {
    const [id, value] = line.split(',');
    const n = Number(value);
    if (id && value !== undefined && value !== '' && Number.isFinite(n)) map.set(id.trim(), n);
  }
  return map;
}

/** Valio gives the lot size of KG products in kg; we order in packs (pieces of packSize kg). */
function lotInPacks(salesUnit: string, allowedLotSize: number, packSize: number): number {
  if (salesUnit.toUpperCase() === 'KG' && packSize > 0) return Math.max(1, Math.ceil(allowedLotSize / packSize));
  return allowedLotSize < 1 ? 1 : allowedLotSize;
}

const pick = (l: Localized | undefined, lang: string) => l?.find((x) => x.language === lang)?.value.trim();

const reliability = readCsv('reliability.csv');
const carbon = readCsv('carbon.csv');
const raw = JSON.parse(readFileSync(path.join(RAW, 'products.json'), 'utf8')) as RawProduct[];

const catalog: CatalogProduct[] = [];
for (const p of raw) {
  if (p.deleted) continue;
  const s = p.synkkaData;
  const nameEn = pick(s?.names, 'en');
  const nameFi = pick(s?.names, 'fi');
  if (!nameEn && !nameFi) continue;

  // Source texts are mixed-language; detect on every language, quote the English one.
  const ingredientNames = (s?.ingredients ?? []).flatMap((i) => (i.names ?? []).map((n) => n.value));
  const en = nameEn ?? nameFi!;
  const fi = nameFi ?? nameEn!;
  const keyText = [pick(s?.keyIngredients, 'en'), pick(s?.keyIngredients, 'fi')].find((t) => t && looksLikeIngredientList(t));
  const { allergens, ingredientData } = deriveAllergens(
    (s?.keyIngredients ?? []).map((k) => k.value),
    ingredientNames,
    (s?.names ?? []).map((n) => n.value),
  );

  const units = deriveUnits(p);
  catalog.push({
    id: String(p.id),
    nameEn: en,
    nameFi: fi,
    ...(pick(s?.names, 'sv') ? { nameSv: pick(s?.names, 'sv') } : {}),
    category: String(p.category),
    salesUnit: p.salesUnit,
    ...units,
    allowedLotSize: lotInPacks(p.salesUnit, p.allowedLotSize, units.packSize),
    temperature: temperature(p.temperatureCondition),
    vendor: p.vendorName ?? '',
    allergens,
    ingredientData,
    dietFlags: deriveDietFlags({ nameEn: en, nameFi: fi, allergens, ingredientData }),
    ...(keyText ? { keyIngredientsText: keyText.slice(0, 1200) } : {}),
    reliability: reliability.get(String(p.id)) ?? null,
    co2PerKg: carbon.get(String(p.id)) ?? null,
  });
}

writeFileSync(OUT, JSON.stringify(catalog));
const mb = statSync(OUT).size / 1024 / 1024;
const unknown = catalog.filter((c) => c.allergens === 'unknown').length;
console.log(`catalog.index.json: ${catalog.length} products (of ${raw.length}), ${mb.toFixed(1)} MB, ${unknown} with unknown allergens`);
if (mb > 25) throw new Error('index exceeds 25 MB');
