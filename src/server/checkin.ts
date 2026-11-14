import { getDb, type Db } from '@/db/client';
import { appendAudit, getOrderLines, listAudit, recordLeftovers } from '@/db/repo';
import { NotFoundError } from './errors';

/** Lines the buyer did not mention were used up, so they are recorded as 0. */
export function submitCheckIn(orderId: string, entries: Array<{ lineId: string; leftoverQty: number }>, db: Db = getDb()): void {
  const lines = getOrderLines(orderId, db);
  if (!lines.length) throw new NotFoundError(`Order ${orderId} was not found`);
  const given = new Map(entries.map((e) => [e.lineId, e.leftoverQty]));
  const unknown = entries.find((e) => !lines.some((l) => l.id === e.lineId));
  if (unknown) throw new NotFoundError(`Order ${orderId} has no line ${unknown.lineId}`);
  const full = lines.map((l) => ({ lineId: l.id, leftoverQty: given.get(l.id) ?? 0 }));
  recordLeftovers(orderId, full, db);
  const conversationId = [...listAudit({ orderId }, db)].sort((a, b) => a.at.localeCompare(b.at))[0]?.conversationId ?? orderId;
  appendAudit({
    conversationId, orderId, actor: 'history', action: 'recordLeftovers',
    summary: `Recorded the check-in for ${orderId}: ${full.filter((e) => e.leftoverQty !== 0).length} lines with leftovers or shortfalls`,
    data: { entries: full },
  }, db);
}
