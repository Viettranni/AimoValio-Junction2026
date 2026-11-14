// The simulated delivery timeline of one order (the gateway's getDeliveryStatus, widget identity).
import { NextResponse } from 'next/server';
import { getDeliveryStatus } from '@/gateway/deliveries';
import { widgetContext } from '@/gateway/widget';
import { failure } from '../../../http';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(getDeliveryStatus(id, widgetContext()));
  } catch (e) {
    return failure(e);
  }
}
