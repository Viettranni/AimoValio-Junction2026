// A minimal OAuth 2.1 sign-in in front of the agent gateway, for MCP clients that insist on OAuth (claude.ai's Connect).
// The connector URL already carries the agent key (/api/mcp/<key>); signing in shows a one-click consent page and then
// issues that same key as the bearer access token, so the gateway's identity and authority rules stay exactly as they
// are. No key in the resource URL, no token: the link stays the secret.
//   /.well-known/oauth-protected-resource[/<path>]  RFC 9728   → which authorization server protects the MCP URL
//   /.well-known/oauth-authorization-server         RFC 8414   → endpoints, PKCE S256, dynamic registration
//   /oauth/register                                  RFC 7591   → any client gets an id (public clients, no secret)
//   /oauth/authorize                                 consent page → code (10 min, PKCE-bound)
//   /oauth/token                                     code or refresh token → access token = the agent key
import { createHash, randomBytes } from 'node:crypto';
import { AuthError, resolveAgent } from './agents';
import type { AgentIdentity } from './types';

const CODE_TTL_MS = 10 * 60_000;
export const TOKEN_TTL_S = 30 * 86_400;

/** The public origin the client used: the tunnel sets X-Forwarded-Host / -Proto (scripts/mcp-only-proxy.ts). */
export function publicBase(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim() || url.host;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export function protectedResourceMetadata(base: string, resourcePath: string) {
  return {
    resource: `${base}${resourcePath || '/api/mcp'}`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    resource_name: 'Valio Aimo agent gateway',
  };
}

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['aimo'],
  };
}

/** The agent key inside an MCP resource URL (…/api/mcp/<key> or …/api/mcp?key=<key>), if it is a valid key. */
export function keyFromResource(resource: string | null | undefined, env?: Record<string, string | undefined>): { key: string; agent: AgentIdentity } | null {
  if (!resource) return null;
  try {
    const u = new URL(resource);
    const key = decodeURIComponent(/^\/api\/mcp\/([^/]+)\/?$/.exec(u.pathname)?.[1] ?? '') || u.searchParams.get('key') || '';
    if (!key) return null;
    return { key, agent: resolveAgent(key, env) };
  } catch (e) {
    if (e instanceof AuthError || e instanceof TypeError) return null;
    throw e;
  }
}

// ── Authorization codes (in memory: one dev server process; a code lives 10 minutes) ──

interface PendingCode { key: string; clientId: string; redirectUri: string; challenge: string; expires: number }
const store = ((globalThis as { __aimoOauthCodes?: Map<string, PendingCode> }).__aimoOauthCodes ??= new Map());

export function issueCode(p: Omit<PendingCode, 'expires'>, now = Date.now()): string {
  for (const [c, v] of store) if (v.expires < now) store.delete(c);
  const code = randomBytes(24).toString('base64url');
  store.set(code, { ...p, expires: now + CODE_TTL_MS });
  return code;
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export class OAuthError extends Error {
  constructor(readonly error: string, description: string) {
    super(description);
  }
}

/** Code + PKCE verifier → the agent key. One use only. */
export function redeemCode(code: string, verifier: string, redirectUri: string | null, now = Date.now()): string {
  const p = store.get(code);
  store.delete(code);
  if (!p || p.expires < now) throw new OAuthError('invalid_grant', 'The code is unknown or expired');
  if (redirectUri && redirectUri !== p.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
  if (!verifier || s256(verifier) !== p.challenge) throw new OAuthError('invalid_grant', 'PKCE verification failed');
  return p.key;
}

/** Refresh tokens carry the key (the client already holds it as its access token). */
export const refreshTokenFor = (key: string) => `rt.${Buffer.from(key).toString('base64url')}`;
export function keyFromRefreshToken(token: string, env?: Record<string, string | undefined>): string {
  const key = token.startsWith('rt.') ? Buffer.from(token.slice(3), 'base64url').toString() : '';
  try { resolveAgent(key, env); } catch { throw new OAuthError('invalid_grant', 'Unknown refresh token'); }
  return key;
}

export const tokenResponse = (key: string) => ({
  access_token: key, token_type: 'Bearer', expires_in: TOKEN_TTL_S, refresh_token: refreshTokenFor(key), scope: 'aimo',
});
