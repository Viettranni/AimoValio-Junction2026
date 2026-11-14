// A buyer's settings: favourites, limits, blocked allergens, approvers (Python: GET /v1/settings).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buyers } from '@/insights/data';
import { NotFound } from '@/insights/errors';
import { settings } from '@/insights/rails';
import { insightsFailure, insightsGateway } from '@/insights/server';
import { parseQuery } from '../http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = parseQuery(req, z.object({ buyerId: z.string().min(1) }));
  if ('error' in q) return q.error;
  try {
    const gw = insightsGateway();
    const buyer = gw.demoBuyer(q.data.buyerId);
    if (!buyer) throw new NotFound(`Unknown organisation ${q.data.buyerId}.`);
    return NextResponse.json(settings({ buyer, all: buyers(), liveApi: gw.liveApi }));
  } catch (e) {
    return insightsFailure(e);
  }
}
