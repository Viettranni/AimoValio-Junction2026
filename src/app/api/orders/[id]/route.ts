import { NextResponse } from 'next/server';
import { getReceipt, listLeftoverRecords } from '@/db/repo';
import { failure, jsonError } from '../../http';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const receipt = getReceipt(id);
    if (!receipt) return jsonError('Order not found', 404);
    const leftovers = listLeftoverRecords(receipt.customerId).filter((r) => r.orderId === id);
    return NextResponse.json({ receipt, leftovers });
  } catch (e) {
    return failure(e);
  }
}
