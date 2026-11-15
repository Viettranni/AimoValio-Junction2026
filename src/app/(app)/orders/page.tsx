import type { Metadata } from 'next';
import { Widget } from '@/ui/Widget';

export const metadata: Metadata = { title: 'Orders · Valio Aimo' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Orders: the assistant on the left, the order draft (then review and receipt) on the right. */
export default async function OrdersPage({ searchParams }: PageProps<'/orders'>) {
  const params = await searchParams;
  return (
    <Widget
      layout="page"
      conversationId={crypto.randomUUID()}
      customerId={first(params.customer) || 'helsinki-juhlapalvelu'}
      mode={first(params.fixture) === '1' ? 'fixture' : 'live'}
      demo={first(params.demo) === '1'}
    />
  );
}
