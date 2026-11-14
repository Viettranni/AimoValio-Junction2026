// Calls one insight tool in an open analysis (Python: POST /v1/insights/sessions/{sid}/tools/{tool}).
import { NextResponse } from 'next/server';
import { insightsFailure, insightsGateway, sourceOf } from '@/insights/server';
import { using } from '@/insights/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ sid: string; tool: string }> }) {
  const { sid, tool } = await params;
  let args: unknown = {};
  try { args = await req.json(); } catch { args = {}; }
  try {
    return NextResponse.json(using({ source: sourceOf(req), fn: () => insightsGateway().insights.call({ sid, tool, args }) }));
  } catch (e) {
    return insightsFailure(e);
  }
}
