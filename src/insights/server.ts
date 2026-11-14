// Server wiring for the insights routes: the process singleton and the error mapping (Python's @guarded).
import { NextResponse } from 'next/server';
import { failure } from '@/app/api/http';
import { now } from '@/db/repo';
import { PlaybookError } from './errors';
import { InsightsGateway } from './gateway';
import { projectCustomers, projectLineRows } from './live';

// On globalThis so Next.js dev-mode module reloads keep analysis sessions.
const g = globalThis as { __aimoInsights?: InsightsGateway };

export function insightsGateway(): InsightsGateway {
  return (g.__aimoInsights ??= new InsightsGateway({
    liveRows: () => projectLineRows(),
    liveCustomers: () => projectCustomers(),
    now: () => now(),
    liveApi: Boolean(process.env.VALIO_API_KEY),
  }));
}

/** Playbook errors keep their status and body (409 next_allowed_tools, 422 fix); everything else is the app's. */
export function insightsFailure(e: unknown): NextResponse {
  if (e instanceof PlaybookError) return NextResponse.json(e.body(), { status: e.status });
  return failure(e);
}

export const sourceOf = (req: Request) => new URL(req.url).searchParams.get('source');
