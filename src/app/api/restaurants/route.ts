// Every restaurant of a demo organisation, with KPIs and a spend sparkline (Python: GET /v1/kitchens).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { NotFound } from '@/insights/errors';
import { insightsFailure, insightsGateway } from '@/insights/server';
import { kitchens } from '@/insights/views';
import { parseQuery } from '../http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = parseQuery(req, z.object({ buyerId: z.string().min(1) }));
  if ('error' in q) return q.error;
  try {
    const gw = insightsGateway();
    const buyer = gw.demoBuyer(q.data.buyerId);
    if (!buyer) throw new NotFound(`Unknown organisation ${q.data.buyerId}.`);
    return NextResponse.json(kitchens({ host: gw, buyer, liveApi: gw.liveApi }));
  } catch (e) {
    return insightsFailure(e);
  }
}
