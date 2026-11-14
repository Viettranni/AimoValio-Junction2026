import type { Metadata } from 'next';
import { RestaurantsPage } from '@/features/restaurants/components/RestaurantsPage';

export const metadata: Metadata = { title: 'Ravintolat · Analytiikka · Aimo' };

export default function Ravintolat() {
  return <RestaurantsPage />;
}
