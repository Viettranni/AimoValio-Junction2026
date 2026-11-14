// Polled by the widget while an approval is pending (the gateway's getOrderStatus, widget identity).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { widgetOrderStatus } from '@/gateway/widget';
import { failure, parseQuery } from '../../http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = parseQuery(req, z.object({ id: z.string().min(1).max(40) }));
  if ('error' in q) return q.error;
  try {
    return NextResponse.json(widgetOrderStatus(q.data.id));
  } catch (e) {
    return failure(e);
  }
}
