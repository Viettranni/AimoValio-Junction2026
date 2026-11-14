// Who the insights pages can show: the demo organisations and this project's own customers (live mode).
import { NextResponse } from 'next/server';
import { buyers } from '@/insights/data';
import { projectCustomers } from '@/insights/live';
import { insightsFailure } from '@/insights/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      demo: buyers().map((b) => ({ id: b.id, name: b.name, sites: b.sites.map((s) => ({ id: s.id, name: s.name })) })),
      live: projectCustomers(),
    });
  } catch (e) {
    return insightsFailure(e);
  }
}
