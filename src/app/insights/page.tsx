import type { Metadata } from 'next';
import { InsightsPage } from '@/features/insights/components/InsightsPage';

export const metadata: Metadata = {
  title: 'Insights · Aimo',
  description: 'Your year in food, and answers about your own order data.',
};

export default async function Insights({ searchParams }: { searchParams: Promise<{ buyerId?: string; siteId?: string }> }) {
  const { buyerId, siteId } = await searchParams;
  return <InsightsPage initialBuyerId={buyerId} initialSiteId={siteId} />;
}
