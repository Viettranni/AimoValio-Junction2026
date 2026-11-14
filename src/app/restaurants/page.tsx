import type { Metadata } from 'next';
import { RestaurantsPage } from '@/features/restaurants/components/RestaurantsPage';

export const metadata: Metadata = {
  title: 'Restaurants · Aimo',
  description: 'Every restaurant in your organisation, with spend, leftovers and delivery details.',
};

export default function Restaurants() {
  return <RestaurantsPage />;
}
