// Token endpoint: authorization code + PKCE, or a refresh token → the agent key as a bearer token.
import { OAuthError, keyFromRefreshToken, redeemCode, tokenResponse } from '@/gateway/oauth';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

export async function POST(request: Request) {
  const text = await request.text();
  const form = request.headers.get('content-type')?.includes('json')
    ? new URLSearchParams(Object.entries(JSON.parse(text || '{}') as Record<string, string>))
    : new URLSearchParams(text);
  try {
    const grant = form.get('grant_type');
    if (grant === 'authorization_code') {
      const key = redeemCode(form.get('code') ?? '', form.get('code_verifier') ?? '', form.get('redirect_uri'));
      return Response.json(tokenResponse(key), { headers: noStore });
    }
    if (grant === 'refresh_token') return Response.json(tokenResponse(keyFromRefreshToken(form.get('refresh_token') ?? '')), { headers: noStore });
    throw new OAuthError('unsupported_grant_type', `grant_type ${grant ?? '(missing)'} is not supported`);
  } catch (e) {
    if (e instanceof OAuthError) return Response.json({ error: e.error, error_description: e.message }, { status: 400, headers: noStore });
    throw e;
  }
}
