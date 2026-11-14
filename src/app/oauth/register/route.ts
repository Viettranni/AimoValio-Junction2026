// RFC 7591 dynamic client registration: public clients (PKCE, no secret); any client may register.
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { client_name?: string; redirect_uris?: string[] };
  return Response.json({
    client_id: `aimo-${randomBytes(8).toString('hex')}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: body.client_name ?? 'MCP client',
    redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris : [],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, { status: 201 });
}
