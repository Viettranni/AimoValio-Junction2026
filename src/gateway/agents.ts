// Agent identity: API key → { agentId, customerId, displayName }. The customer always comes from the key;
// the widget has no key and gets its identity server-side (WIDGET_AGENT).
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AgentIdentity } from './types';

/** Documented in .env.example. Override all keys with AIMO_AGENT_KEYS (JSON object: key → identity). */
export const DEMO_AGENT_KEY = 'aimo-demo-agent-key';

/**
 * The preset key shown in the copy-paste connect link (static page and chat, see src/gateway/connect.ts). Claude's
 * custom connectors take only a URL, so this key travels as `?key=` (src/mcp/http.ts). Override with AIMO_CONNECT_KEY.
 */
export const PRESET_CONNECT_KEY = 'sakdnkfbwjklebfkjABF';

export const connectKey = (env: Record<string, string | undefined> = process.env) =>
  env.AIMO_CONNECT_KEY && env.AIMO_CONNECT_KEY.length >= 8 ? env.AIMO_CONNECT_KEY : PRESET_CONNECT_KEY;

const DEMO_IDENTITY: AgentIdentity = {
  agentId: 'procurement-agent',
  customerId: 'helsinki-juhlapalvelu',
  displayName: 'Helsinki Juhlapalvelu purchasing agent',
};

/**
 * The Aimo chat widget: a gateway client like any other agent, bound to the demo customer. It has no API key; the
 * widget's own API routes resolve it server-side, so the browser never holds an agent key. humanInTheLoop: a buyer
 * reviews every order on screen, so their per-line allergen tick may count as the allergen sign-off. Nothing else
 * in the policy changes for it.
 */
export const WIDGET_AGENT: Readonly<AgentIdentity> = Object.freeze({
  agentId: 'aimo-widget',
  customerId: 'helsinki-juhlapalvelu',
  displayName: 'Aimo chat (Helsinki Juhlapalvelu)',
  humanInTheLoop: true,
});

export const widgetAgent = (): AgentIdentity => ({ ...WIDGET_AGENT });

export class AuthError extends Error {
  constructor(message = 'Unknown or missing agent API key') {
    super(message);
    this.name = 'AuthError';
  }
}

function isIdentity(v: unknown): v is AgentIdentity {
  const o = v as Partial<AgentIdentity> | null;
  return !!o && typeof o.agentId === 'string' && !!o.agentId && typeof o.customerId === 'string' && !!o.customerId
    && typeof o.displayName === 'string';
}

/**
 * Keys from AIMO_AGENT_KEYS; when it is unset, the demo key and the connect key (preset or AIMO_CONNECT_KEY).
 * Invalid config fails closed (no keys).
 */
export function agentKeys(env: Record<string, string | undefined> = process.env): Record<string, AgentIdentity> {
  const raw = env.AIMO_AGENT_KEYS;
  if (!raw) return { [DEMO_AGENT_KEY]: DEMO_IDENTITY, [connectKey(env)]: DEMO_IDENTITY };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter((e): e is [string, AgentIdentity] => e[0].length >= 8 && isIdentity(e[1]));
    // A key is never a human in the loop: only the widget's server-side identity is.
    if (entries.length) return Object.fromEntries(entries.map(([k, v]) => [k, { agentId: v.agentId, customerId: v.customerId, displayName: v.displayName }]));
  } catch { /* fall through */ }
  console.error('[gateway] AIMO_AGENT_KEYS is set but is not a JSON object of key (≥ 8 chars) → {agentId, customerId, displayName}; no agent key is accepted');
  return {};
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** The identity behind an API key; throws AuthError for a missing or unknown key. */
export function resolveAgent(key: string | null | undefined, env: Record<string, string | undefined> = process.env): AgentIdentity {
  if (!key) throw new AuthError('Missing agent API key');
  const wanted = digest(key);
  for (const [k, identity] of Object.entries(agentKeys(env))) {
    if (timingSafeEqual(digest(k), wanted)) return identity;
  }
  throw new AuthError();
}

/** The caller's key: `Authorization: Bearer <key>`, else the URL's `?key=` (for clients that take only a URL). */
export function requestKey(authorization: string | null | undefined, url: string): string | null {
  const bearer = bearerToken(authorization);
  if (bearer) return bearer;
  try { return new URL(url).searchParams.get('key')?.trim() || null; } catch { return null; }
}

/** `Authorization: Bearer <key>` → key, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  return m ? m[1].trim() : null;
}
