import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PRESET_CONNECT_KEY } from './agents';
import {
  OAuthError, authorizationServerMetadata, issueCode, keyFromRefreshToken, keyFromResource, protectedResourceMetadata,
  publicBase, redeemCode, tokenResponse,
} from './oauth';

const verifier = 'a'.repeat(50);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const base = 'https://abc.trycloudflare.com';

describe('OAuth sign-in for MCP connectors', () => {
  it('builds metadata from the public host the tunnel forwarded', () => {
    const req = new Request('http://localhost:3100/.well-known/oauth-authorization-server', { headers: { 'x-forwarded-host': 'abc.trycloudflare.com', 'x-forwarded-proto': 'https' } });
    expect(publicBase(req)).toBe(base);
    expect(authorizationServerMetadata(base)).toMatchObject({
      issuer: base, registration_endpoint: `${base}/oauth/register`, code_challenge_methods_supported: ['S256'],
    });
    expect(protectedResourceMetadata(base, `/api/mcp/${PRESET_CONNECT_KEY}`)).toMatchObject({
      resource: `${base}/api/mcp/${PRESET_CONNECT_KEY}`, authorization_servers: [base],
    });
  });

  it('authorizes only a resource URL that carries a valid key', () => {
    expect(keyFromResource(`${base}/api/mcp/${PRESET_CONNECT_KEY}`, {})?.agent.customerId).toBe('helsinki-juhlapalvelu');
    expect(keyFromResource(`${base}/api/mcp?key=${PRESET_CONNECT_KEY}`, {})?.key).toBe(PRESET_CONNECT_KEY);
    expect(keyFromResource(`${base}/api/mcp`, {})).toBeNull();
    expect(keyFromResource(`${base}/api/mcp/not-a-key-123`, {})).toBeNull();
    expect(keyFromResource('nonsense', {})).toBeNull();
  });

  it('redeems a code once, only with the right PKCE verifier and redirect', () => {
    const p = { key: PRESET_CONNECT_KEY, clientId: 'c', redirectUri: 'https://claude.ai/api/mcp/auth_callback', challenge };
    const code = issueCode(p);
    expect(() => redeemCode(issueCode(p), 'wrong-verifier', null)).toThrow(OAuthError);
    expect(() => redeemCode(issueCode(p), verifier, 'https://evil.example/cb')).toThrow(/redirect_uri/);
    expect(redeemCode(code, verifier, p.redirectUri)).toBe(PRESET_CONNECT_KEY);
    expect(() => redeemCode(code, verifier, p.redirectUri)).toThrow(/unknown or expired/);
    const old = issueCode(p, Date.now() - 11 * 60_000);
    expect(() => redeemCode(old, verifier, null)).toThrow(/expired/);
  });

  it('issues the key as the bearer token, and refreshes it', () => {
    const t = tokenResponse(PRESET_CONNECT_KEY);
    expect(t).toMatchObject({ access_token: PRESET_CONNECT_KEY, token_type: 'Bearer' });
    expect(keyFromRefreshToken(t.refresh_token, {})).toBe(PRESET_CONNECT_KEY);
    expect(() => keyFromRefreshToken('rt.bm9wZQ', {})).toThrow(OAuthError);
  });
});
