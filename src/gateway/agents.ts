// Agent identity: API key → { agentId, customerId, displayName }. The customer always comes from the key.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AgentIdentity } from './types';

/** Documented in .env.example. Override all keys with AIMO_AGENT_KEYS (JSON object: key → identity). */
export const DEMO_AGENT_KEY = 'aimo-demo-agent-key';

const DEFAULT_KEYS: Record<string, AgentIdentity> = {
  [DEMO_AGENT_KEY]: {
    agentId: 'procurement-agent',
    customerId: 'helsinki-juhlapalvelu',
    displayName: 'Helsinki Juhlapalvelu purchasing agent',
  },
};

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

/** Keys from AIMO_AGENT_KEYS, or the demo key when it is unset or invalid. */
export function agentKeys(env: Record<string, string | undefined> = process.env): Record<string, AgentIdentity> {
  const raw = env.AIMO_AGENT_KEYS;
  if (!raw) return DEFAULT_KEYS;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter((e): e is [string, AgentIdentity] => e[0].length >= 8 && isIdentity(e[1]));
    if (entries.length) return Object.fromEntries(entries);
  } catch { /* fall through */ }
  console.warn('[gateway] AIMO_AGENT_KEYS is not a valid JSON object of key → {agentId, customerId, displayName}; using the demo key');
  return DEFAULT_KEYS;
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

/** `Authorization: Bearer <key>` → key, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  return m ? m[1].trim() : null;
}
