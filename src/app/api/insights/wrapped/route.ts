// "Your year": a story of cards (Python: GET /v1/insights/wrapped).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { insightsFailure, insightsGateway } from '@/insights/server';
import { using } from '@/insights/store';
import { wrapped } from '@/insights/views';
import { parseQuery } from '../../http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = parseQuery(req, z.object({ buyerId: z.string().min(1), siteId: z.string().optional(), source: z.enum(['demo', 'live']).optional() }));
  if ('error' in q) return q.error;
  try {
    const { buyerId, siteId, source } = q.data;
    return NextResponse.json(using({ source, fn: () => wrapped({ host: insightsGateway(), buyerId, siteId: siteId || null }) }));
  } catch (e) {
    return insightsFailure(e);
  }
}
