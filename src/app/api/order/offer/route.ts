// Review opened in the widget: a fixed-price offer for the conversation's draft, from the gateway (quoteDraft).
// The widget's identity is resolved here, server-side; the browser never holds an agent key.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { widgetOffer } from '@/gateway/widget';
import { failure, parseBody } from '../../http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = await parseBody(req, z.object({ conversationId: z.string().min(1).max(200) }));
  if ('error' in b) return b.error;
  try {
    return NextResponse.json(await widgetOffer(b.data.conversationId));
  } catch (e) {
    return failure(e);
  }
}
