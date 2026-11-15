import type { Metadata } from 'next';
import { ProductsPage } from '@/features/products/ProductsPage';

export const metadata: Metadata = { title: 'Products · Valio Aimo' };

export default function Products() {
  return <ProductsPage />;
}
