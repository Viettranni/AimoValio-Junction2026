// Approval queue for the human approver (the approval page). Not reachable from MCP.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listApprovals } from '@/gateway/approvals';
import { policyFor } from '@/gateway/policies';
import { failure, parseQuery } from '../http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = parseQuery(req, z.object({ status: z.enum(['pending', 'approved', 'rejected', 'requoted', 'all']).default('all') }));
  if ('error' in q) return q.error;
  try {
    const rows = listApprovals(q.data.status === 'all' ? {} : { status: q.data.status });
    return NextResponse.json(rows.map((r) => ({ ...r, customerName: policyFor(r.approval.customerId).customerName })));
  } catch (e) {
    return failure(e);
  }
}
