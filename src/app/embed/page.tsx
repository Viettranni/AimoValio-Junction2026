import type { Metadata } from 'next';
import { Widget } from '@/ui/Widget';

export const metadata: Metadata = { title: 'Aimo Assistant' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The widget document loaded inside the host site's iframe (see public/widget.js). */
export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <Widget
      conversationId={crypto.randomUUID()}
      customerId={first(params.customer) || 'helsinki-juhlapalvelu'}
      mode={first(params.fixture) === '1' ? 'fixture' : 'live'}
      demo={first(params.demo) === '1'}
      parentOrigin={first(params.parentOrigin)}
    />
  );
}
