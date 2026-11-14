// Runs the Aimo agent gateway MCP server over stdio: `npx tsx src/mcp/stdio.ts` from the project root.
// Identity: AIMO_AGENT_KEY (catalogue tools work without it). Stdout carries the protocol, so nothing else may print to it.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';

// MCP clients start stdio servers with a minimal environment: take Valio and Anthropic keys from .env.local
// when the client config doesn't pass them (variables the client sets win).
const envFile = resolve(process.cwd(), '.env.local');
if (existsSync(envFile)) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync(envFile, 'utf8')))) {
    if (process.env[k] === undefined && v !== undefined) process.env[k] = v;
  }
}

type Era = 'modern' | 'legacy';
type Factory = (era?: Era) => unknown;

/**
 * Mastra's startStdio() only speaks MCP 2026-07-28 and rejects 2025-era clients (an `initialize` opening,
 * as Claude Desktop and most IDEs still send). The MCP SDK's serveStdio (the same one Mastra uses, a dependency
 * of @mastra/mcp) can serve both eras from one factory, so we hand it Mastra's own per-connection factory.
 * If either internal is missing after an upgrade, fall back to startStdio() (modern clients only).
 */
async function main() {
  const { aimoGatewayServer } = await import('./server');
  const factory = (aimoGatewayServer as unknown as { createServerInstance?: Factory }).createServerInstance;
  const stdio = await import('@modelcontextprotocol/server/stdio').catch(() => null);
  if (typeof factory !== 'function' || !stdio?.serveStdio) {
    console.error('[aimo-gateway] serving MCP 2026-07-28 clients only');
    return aimoGatewayServer.startStdio();
  }
  stdio.serveStdio(
    (ctx) => factory.call(aimoGatewayServer, (ctx as { era?: Era } | undefined)?.era ?? 'modern') as ReturnType<Parameters<typeof stdio.serveStdio>[0]>,
    { legacy: 'serve', onerror: (error) => console.error('[aimo-gateway] stdio error', error) },
  );
}

main().catch((err: unknown) => {
  console.error('aimo-gateway MCP server failed to start', err);
  process.exit(1);
});
