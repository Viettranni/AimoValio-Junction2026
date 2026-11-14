import { NextResponse } from 'next/server';
import { z } from 'zod';
import { approveAndSubmit } from '@/server/orders';
import { failure, parseBody } from '../../http';

export async function POST(req: Request) {
  const b = await parseBody(req, z.object({ conversationId: z.string().min(1), confirmedUnknownLineIds: z.array(z.string()).max(500).optional() }));
  if ('error' in b) return b.error;
  try {
    return NextResponse.json(await approveAndSubmit(b.data.conversationId, undefined, b.data.confirmedUnknownLineIds));
  } catch (e) {
    return failure(e);
  }
}
