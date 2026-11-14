// GET /api/connect → the MCP link to paste into Claude (see src/gateway/connect.ts).
import { connectInfo } from '@/gateway/connect';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return Response.json(connectInfo(new URL(request.url).origin));
}
