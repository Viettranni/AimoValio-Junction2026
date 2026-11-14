import type { Tool } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { MCPClient } from '@mastra/mcp';
import { aimoProductTools } from './aimo-products';

const SERVER = 'aimo-products';
const CONNECT_TIMEOUT_MS = 8000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = Tool<any, any, any, any, any, any, any>;

let toolsPromise: Promise<Record<string, AnyTool>> | null = null;

async function connect(): Promise<Record<string, AnyTool>> {
  const client = new MCPClient({
    id: 'aimo-products-client',
    servers: {
      [SERVER]: { command: 'npx', args: ['tsx', 'src/mcp/stdio.ts'], cwd: process.cwd(), timeout: 30_000 },
    },
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${CONNECT_TIMEOUT_MS} ms`)), CONNECT_TIMEOUT_MS);
  });
  try {
    const toolsets = await Promise.race([client.listToolsets(), timeout]);
    const tools = toolsets[SERVER];
    if (!tools || Object.keys(tools).length === 0) throw new Error('server listed no tools');
    return tools as Record<string, AnyTool>;
  } catch (err) {
    void client.disconnect().catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The aimo-products tools as seen through our own MCP client (one stdio server per process),
 * so agents use the same interface an external purchasing agent would. Falls back to the
 * in-process tool objects if the server can't be reached.
 */
export function getProductTools(): Promise<Record<string, AnyTool>> {
  toolsPromise ??= connect().catch((err: unknown) => {
    console.warn(`[aimo-products] MCP connection failed (${(err as Error).message}); using in-process tools`);
    return aimoProductTools as Record<string, AnyTool>;
  });
  return toolsPromise;
}

const NO_TOOLS = 'aimo.noTools';

/** Request context for agent calls that send no tools, so no MCP server is spawned for them. */
export function toolFreeContext(): RequestContext {
  const requestContext = new RequestContext();
  requestContext.setRaw(NO_TOOLS, true);
  return requestContext;
}

/** Agent `tools` resolver: the MCP tools, connected lazily, unless the call is tool-free. */
export function productToolsFor({ requestContext }: { requestContext: RequestContext }) {
  return requestContext.getRaw(NO_TOOLS) ? {} : getProductTools();
}
