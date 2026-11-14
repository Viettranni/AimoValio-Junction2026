import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fastForward, nextDeliveryStep, resetDemo } from '@/server/demo';
import { failure, parseBody } from '../http';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fastForward'), conversationId: z.string().min(1) }),
  z.object({ action: z.literal('nextDeliveryStep'), conversationId: z.string().min(1) }),
  z.object({ action: z.literal('reset') }),
]);

export async function POST(req: Request) {
  const b = await parseBody(req, bodySchema);
  if ('error' in b) return b.error;
  try {
    if (b.data.action === 'reset') {
      resetDemo();
      return NextResponse.json({ ok: true });
    }
    if (b.data.action === 'nextDeliveryStep') return NextResponse.json(nextDeliveryStep(b.data.conversationId));
    return NextResponse.json(fastForward(b.data.conversationId));
  } catch (e) {
    return failure(e);
  }
}
