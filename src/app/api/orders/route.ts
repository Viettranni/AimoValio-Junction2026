import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listOrders } from '@/db/repo';
import { failure, parseQuery } from '../http';

export async function GET(req: Request) {
  const q = parseQuery(req, z.object({ customerId: z.string().min(1).default('helsinki-juhlapalvelu') }));
  if ('error' in q) return q.error;
  try {
    return NextResponse.json(listOrders(q.data.customerId));
  } catch (e) {
    return failure(e);
  }
}
