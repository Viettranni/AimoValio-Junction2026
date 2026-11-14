// A typed question (+ page filters) -> chart, caption and facts, through the insight rails (Python: POST /v1/insights/ask).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ASK_FILTERS } from '@/insights/analyst';
import { insightsFailure, insightsGateway } from '@/insights/server';
import { using } from '@/insights/store';
import { validateInput } from '@/insights/validate';
import { parseBody } from '../../http';

export const dynamic = 'force-dynamic';

const Body = z.object({
  buyerId: z.string().min(1),
  prompt: z.string().default(''),
  filters: z.object({
    site: z.string().optional(), siteId: z.string().nullish(), category: z.string().optional(),
    event_type: z.string().optional(), period: z.unknown().optional(),
  }).default({}),
  siteId: z.string().nullish(),
  source: z.enum(['demo', 'live']).nullish(),
});

export async function POST(req: Request) {
  const b = await parseBody(req, Body);
  if ('error' in b) return b.error;
  const { buyerId, prompt, filters, siteId, source } = b.data;
  try {
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
    validateInput({ schema: ASK_FILTERS, tool: 'ask', args: clean });
    const answer = await using({ source, fn: () => insightsGateway().analyst.ask({ prompt, filters: clean, buyerId, siteId: siteId ?? null }) });
    return NextResponse.json(answer);
  } catch (e) {
    return insightsFailure(e);
  }
}
