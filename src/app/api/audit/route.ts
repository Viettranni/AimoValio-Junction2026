import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listAudit } from '@/db/repo';
import { failure, jsonError, parseQuery } from '../http';

export async function GET(req: Request) {
  const q = parseQuery(req, z.object({ conversationId: z.string().min(1).optional(), orderId: z.string().min(1).optional() }));
  if ('error' in q) return q.error;
  if (!q.data.conversationId && !q.data.orderId) return jsonError('conversationId or orderId is required', 400);
  try {
    return NextResponse.json(listAudit(q.data));
  } catch (e) {
    return failure(e);
  }
}
