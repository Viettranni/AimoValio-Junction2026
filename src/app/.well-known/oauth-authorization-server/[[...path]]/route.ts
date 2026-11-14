// RFC 8414: the authorization server's endpoints (see src/gateway/oauth.ts).
import { authorizationServerMetadata, publicBase } from '@/gateway/oauth';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return Response.json(authorizationServerMetadata(publicBase(request)), { headers: { 'access-control-allow-origin': '*' } });
}
