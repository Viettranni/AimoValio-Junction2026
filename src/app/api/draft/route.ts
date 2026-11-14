import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getProduct } from '@/catalog';
import { appendAudit, getDraftByConversation, now, saveDraft } from '@/db/repo';
import { applyDraftChange } from '@/domain/draft';
import { pendingOfferFor } from '@/gateway/store';
import { failure, jsonError, parseBody, parseQuery } from '../http';

const changeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('setPacks'), lineId: z.string(), packs: z.number().int().min(0) }),
  z.object({ kind: z.literal('historyChoice'), lineId: z.string(), choice: z.enum(['history', 'suggested']) }),
  z.object({ kind: z.literal('removeLine'), lineId: z.string() }),
]);

export async function GET(req: Request) {
  const q = parseQuery(req, z.object({ conversationId: z.string().min(1) }));
  if ('error' in q) return q.error;
  try {
    return NextResponse.json(getDraftByConversation(q.data.conversationId));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  const b = await parseBody(req, z.object({ conversationId: z.string().min(1), change: changeSchema }));
  if ('error' in b) return b.error;
  const { conversationId, change } = b.data;
  try {
    const draft = getDraftByConversation(conversationId);
    if (!draft) return jsonError('No draft for this conversation', 404);
    if (draft.status === 'submitted') return jsonError('This order has already been submitted', 400);
    // The approver signs off on exactly what the offer lists; edits would be silently dropped by that order.
    if (pendingOfferFor(draft)) return jsonError('This order is waiting for approval; the draft can\'t change until the approver decides', 409);
    const result = applyDraftChange(draft, change, { getProduct });
    saveDraft({ ...result.draft, updatedAt: now().toISOString() });
    appendAudit({
      conversationId, actor: 'buyer', action: change.kind,
      summary: `Buyer edited the draft: ${change.kind} on ${change.lineId}`, data: change,
    });
    return NextResponse.json(result);
  } catch (e) {
    return failure(e);
  }
}
