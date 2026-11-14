import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CatalogProduct } from '@/contracts';

let catalog: CatalogProduct[] | null = null;

/** Lazy singleton over data/catalog.index.json (built by `npm run build:index`). */
export function loadCatalog(): CatalogProduct[] {
  if (!catalog) {
    const file = path.join(process.cwd(), 'data', 'catalog.index.json');
    catalog = JSON.parse(readFileSync(file, 'utf8')) as CatalogProduct[];
  }
  return catalog;
}
