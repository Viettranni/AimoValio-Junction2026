// The human decision on one approval. The only path that approves an agent's order; no MCP tool calls it.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { decideApproval } from '@/gateway/approvals';
import { GatewayError } from '@/gateway/offers';
import { failure, jsonError, parseBody } from '../../http';

const STATUS = { not_found: 404, conflict: 409, invalid: 400 } as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await parseBody(req, z.object({
    decision: z.enum(['approve', 'reject']),
    approverName: z.string().trim().min(1).max(100),
    note: z.string().max(500).optional(),
  }));
  if ('error' in b) return b.error;
  try {
    return NextResponse.json(await decideApproval(id, b.data));
  } catch (e) {
    if (e instanceof GatewayError) return jsonError(e.message, STATUS[e.code]);
    return failure(e);
  }
}
