// The copy-paste MCP link for Claude (and any client that takes only a URL): <base>/api/mcp/<connect key>.
// The public base comes from the tunnel `npm run dev` opens (written to data/connect.json by scripts/dev.ts),
// else AIMO_PUBLIC_URL; the local base from AIMO_BASE_URL, else the request's own origin.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { connectKey } from './agents';

export const CONNECT_FILE = path.join('data', 'connect.json');

export interface ConnectInfo {
  /** The link to paste into Claude: public when a tunnel is up, else local. */
  mcpUrl: string;
  /** Same server on this machine (Claude Code, Cursor, Inspector). */
  localMcpUrl: string;
  /** True when mcpUrl is reachable from outside this machine (claude.ai / Claude Desktop connectors need that). */
  isPublic: boolean;
  key: string;
}

type Env = Record<string, string | undefined>;

/** The tunnel's public base URL that scripts/dev.ts wrote, or null. */
export function tunnelBaseUrl(file = CONNECT_FILE): string | null {
  try {
    const { publicBaseUrl } = JSON.parse(readFileSync(file, 'utf8')) as { publicBaseUrl?: unknown };
    return typeof publicBaseUrl === 'string' && /^https:\/\//.test(publicBaseUrl) ? publicBaseUrl : null;
  } catch {
    return null;
  }
}

const mcpLink = (base: string, key: string) => `${base.replace(/\/+$/, '')}/api/mcp/${encodeURIComponent(key)}`;

export function connectInfo(requestOrigin: string | null, env: Env = process.env, file = CONNECT_FILE): ConnectInfo {
  const key = connectKey(env);
  const local = env.AIMO_BASE_URL || requestOrigin || `http://localhost:${env.PORT ?? 3100}`;
  const pub = tunnelBaseUrl(file) ?? env.AIMO_PUBLIC_URL ?? null;
  return { mcpUrl: mcpLink(pub ?? local, key), localMcpUrl: mcpLink(local, key), isPublic: !!pub, key };
}
