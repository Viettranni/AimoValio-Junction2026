// Insights statements, left-over chart and tips for one buyer (Python: GET /v1/insights).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forBuyer } from '@/insights/rails';
import { insightsFailure } from '@/insights/server';
import { parseQuery } from '../http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = parseQuery(req, z.object({ buyerId: z.string().min(1) }));
  if ('error' in q) return q.error;
  try {
    // This project has no order-playbook sessions, so there are no gateway decisions to count.
    return NextResponse.json(forBuyer({ buyerId: q.data.buyerId, decisions: [] }));
  } catch (e) {
    return insightsFailure(e);
  }
}
