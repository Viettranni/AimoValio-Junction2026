// Opens an analysis on the insight rails (Python: POST /v1/insights/sessions).
import { NextResponse } from 'next/server';
import { insightsFailure, insightsGateway, sourceOf } from '@/insights/server';
import { using } from '@/insights/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown = {};
  try { body = await req.json(); } catch { body = {}; }
  try {
    const args = { ...(typeof body === 'object' && body !== null ? body : {}), agent: 'analyst' };
    const out = using({ source: sourceOf(req), fn: () => insightsGateway().insights.call({ sid: null, tool: 'start_analysis', args }) });
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    return insightsFailure(e);
  }
}
