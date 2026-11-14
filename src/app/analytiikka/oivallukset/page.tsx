import type { Metadata } from 'next';
import { InsightsPage } from '@/features/insights/components/InsightsPage';

export const metadata: Metadata = { title: 'Analytiikka · Aimo' };

export default async function Oivallukset({ searchParams }: { searchParams: Promise<{ buyerId?: string; siteId?: string }> }) {
  const { buyerId, siteId } = await searchParams;
  return <InsightsPage initialBuyerId={buyerId} initialSiteId={siteId} />;
}
