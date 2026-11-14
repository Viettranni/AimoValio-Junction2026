// RFC 9728: which authorization server protects the MCP URL (/.well-known/oauth-protected-resource/api/mcp/<key>).
import { protectedResourceMetadata, publicBase } from '@/gateway/oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  return Response.json(protectedResourceMetadata(publicBase(request), path?.length ? `/${path.join('/')}` : ''), {
    headers: { 'access-control-allow-origin': '*' },
  });
}
