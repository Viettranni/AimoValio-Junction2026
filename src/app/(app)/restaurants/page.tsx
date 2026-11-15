import type { Metadata } from 'next';
import { GroupOverview } from '@/features/restaurants/components/GroupOverview';

export const metadata: Metadata = { title: 'Restaurants · Valio Aimo' };

export default function RestaurantsPage() {
  return <GroupOverview />;
}
