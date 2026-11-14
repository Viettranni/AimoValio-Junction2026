// Approve in the widget = the gateway's placeOrder, the same policy as every external agent.
// Ordered, pending_approval (a named human signs off), requote (new offer) or not_orderable.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { widgetPlaceOrder } from '@/gateway/widget';
import { failure, parseBody } from '../../http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = await parseBody(req, z.object({
    conversationId: z.string().min(1).max(200),
    offerId: z.string().min(1).max(40),
    allergenLineIds: z.array(z.string().max(80)).max(500).optional(),
  }));
  if ('error' in b) return b.error;
  try {
    return NextResponse.json(await widgetPlaceOrder(b.data));
  } catch (e) {
    return failure(e);
  }
}
