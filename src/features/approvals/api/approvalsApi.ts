import { z } from 'zod';

const PENDING_URL = '/api/approvals?status=pending';

const PendingRows = z.array(z.unknown());

/** How many orders are waiting for a human approver. */
export async function fetchPendingCount(): Promise<number> {
  const res = await fetch(PENDING_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Approvals request failed: ${res.status}`);
  return PendingRows.parse(await res.json()).length;
}
