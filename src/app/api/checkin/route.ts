import { NextResponse } from 'next/server';
import { z } from 'zod';
import { submitCheckIn } from '@/server/checkin';
import { failure, parseBody } from '../http';

const bodySchema = z.object({
  orderId: z.string().min(1),
  entries: z.array(z.object({ lineId: z.string().min(1), leftoverQty: z.number().finite() })),
});

export async function POST(req: Request) {
  const b = await parseBody(req, bodySchema);
  if ('error' in b) return b.error;
  try {
    submitCheckIn(b.data.orderId, b.data.entries);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
