// The widget's "My orders": the gateway's listOrders for the widget identity, with each order's delivery state.
import { NextResponse } from 'next/server';
import { listAgentOrders } from '@/gateway/drafts';
import { widgetContext } from '@/gateway/widget';
import { failure } from '../http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(listAgentOrders(widgetContext(), 100).orders);
  } catch (e) {
    return failure(e);
  }
}
