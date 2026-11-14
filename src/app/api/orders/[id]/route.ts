import { NextResponse } from 'next/server';
import { listLeftoverRecords } from '@/db/repo';
import { getOrder } from '@/gateway/drafts';
import { widgetContext } from '@/gateway/widget';
import { failure } from '../../http';

export const dynamic = 'force-dynamic';

/** One order of the widget's customer: receipt, recorded leftovers and the simulated delivery. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { receipt, delivery } = getOrder(id, widgetContext());
    const leftovers = listLeftoverRecords(receipt.customerId).filter((r) => r.orderId === id);
    return NextResponse.json({ receipt, leftovers, delivery });
  } catch (e) {
    return failure(e);
  }
}
