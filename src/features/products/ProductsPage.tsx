'use client';

import { useEffect, useState } from 'react';

interface ProductCard {
  id: string;
  name: string;
  nameFi: string;
  packDescription: string;
  vendor: string;
  temperature: 'frozen' | 'chilled' | 'ambient' | 'unknown';
  allergensKnown: boolean;
  price: number | null;
  inStock: boolean | null;
  supplierDelivered: boolean;
}

interface ProductsResponse {
  date: string;
  live: boolean;
  products: ProductCard[];
}

/** Shortcut chips: an English label, and the query that searches best (Finnish where the catalogue's names are Finnish). */
const QUICK: Array<[label: string, query: string]> = [
  ['Lactose-free milk', 'lactose-free milk'], ['Chicken', 'broileri'], ['Rice', 'riisi'], ['Salmon', 'salmon'],
  ['Potatoes', 'peruna'], ['Cheese', 'juusto'], ['Bread', 'leipä'],
];
const eur = (v: number) => v.toLocaleString('en-IE', { style: 'currency', currency: 'EUR' });
const TEMP: Record<ProductCard['temperature'], string> = { frozen: 'Frozen', chilled: 'Chilled', ambient: 'Ambient', unknown: '' };

function status(p: ProductCard): { text: string; tone: string } | null {
  if (p.inStock === false) return { text: 'Not available for next delivery', tone: 'text-danger' };
  if (!p.allergensKnown) return { text: 'Allergen data missing', tone: 'text-app-amber' };
  if (p.inStock === null) return null;
  return { text: p.supplierDelivered ? 'Supplier delivered' : 'In stock', tone: 'text-app-teal' };
}

/** Products: search the Valio Aimo catalogue, with the fixed price per pack for the next delivery day. */
export function ProductsPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState(QUICK[0][1]);
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/products?${new URLSearchParams({ q: query })}`, { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok) throw new Error(json?.error ?? `Request failed (${r.status})`);
        return json as ProductsResponse;
      })
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Loading failed'); });
    return () => { alive = false; };
  }, [query]);

  const loading = data === null && error === null;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-navy">Products</h1>
        <form
          role="search"
          className="flex w-full max-w-md items-center gap-2 rounded-full bg-white px-4 py-1.5 shadow-soft"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) { setData(null); setQuery(input.trim()); }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-none text-muted" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" strokeLinecap="round" />
          </svg>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search products, e.g. lactose-free milk"
            aria-label="Search products"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[14.5px] text-ink outline-none placeholder:text-muted"
          />
        </form>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK.map(([label, q]) => (
          <button
            key={label}
            type="button"
            aria-pressed={q === query}
            onClick={() => { setInput(''); if (q !== query) { setData(null); setQuery(q); } }}
            className={`rounded-full px-4 py-1.5 text-[13.5px] font-medium transition-colors ${
              q === query ? 'bg-navy text-white' : 'bg-white text-navy shadow-soft hover:bg-sky'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="mt-6 rounded-xl bg-white px-5 py-4 text-[14px] text-danger shadow-soft">Products could not be loaded ({error}).</p>}

      {data && (
        <p className="mt-5 text-[13px] text-muted">
          {data.products.length} results for “{QUICK.find(([, q]) => q === query)?.[0] ?? query}” ·{' '}
          {data.live ? `fixed prices for delivery on ${new Date(data.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, excl. VAT` : 'prices unavailable right now'}
        </p>
      )}

      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy={loading}>
        {loading &&
          Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="h-[148px] rounded-2xl bg-white p-5 shadow-soft">
              <div className="aimo-shimmer h-4 w-3/4 rounded" />
              <div className="aimo-shimmer mt-3 h-3 w-1/2 rounded" />
              <div className="aimo-shimmer mt-10 h-5 w-1/3 rounded" />
            </li>
          ))}
        {data?.products.map((p) => {
          const s = status(p);
          return (
            <li key={p.id} className="flex flex-col rounded-2xl bg-white p-5 shadow-soft">
              <div className="text-[15px] font-semibold leading-snug text-ink" title={p.nameFi}>{p.name}</div>
              <div className="mt-1 text-[13px] text-muted">
                {[p.packDescription, TEMP[p.temperature]].filter(Boolean).join(' · ')}
              </div>
              <div className="mt-0.5 truncate text-[12.5px] text-muted">{p.vendor}</div>
              <div className="mt-auto flex items-end justify-between gap-2 pt-4">
                <span className={`text-[13px] font-medium ${s?.tone ?? ''}`}>{s?.text}</span>
                <span className="text-[17px] font-bold tabular-nums text-navy">{p.price === null ? '—' : eur(p.price)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {data && data.products.length === 0 && <p className="mt-6 text-[14px] text-muted">No products match “{query}”.</p>}
    </main>
  );
}
