import type { Tool } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { MCPClient } from '@mastra/mcp';
import type { Allergen, AllergenCheck, DietFlag } from '@/contracts';
import { checkAllergens } from '@/catalog';
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
    // The server is the full agent gateway; the planning agents only get the catalogue tools.
    const listed = (toolsets[SERVER] ?? {}) as Record<string, AnyTool>;
    const tools = Object.fromEntries(Object.entries(listed).filter(([name]) => name in aimoProductTools));
    if (Object.keys(tools).length === 0) throw new Error('server listed no catalogue tools');
    return tools;
  } catch (err) {
    void client.disconnect().catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The catalogue tools (aimo-products) of the agent gateway as seen through our own MCP client (one stdio server per process),
 * so agents use the same interface an external purchasing agent would. Falls back to the
 * in-process tool objects if the server can't be reached.
 */
export function getProductTools(): Promise<Record<string, AnyTool>> {
  // Inside the gateway's own stdio server (planEvent) the tools are local: don't spawn a second server.
  if (process.env.AIMO_MCP_SERVER_PROCESS === '1') return Promise.resolve(aimoProductTools as Record<string, AnyTool>);
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

let checkFallbackWarned = false;

/**
 * The allergen step's checkAllergens, called through the aimo-products MCP client: the same tool an
 * external purchasing agent would use. If the call fails, the in-process check runs instead (one warning).
 */
export async function checkAllergensViaMcp(
  ids: string[], constraints: { excludeAllergens?: Allergen[]; requireDiet?: DietFlag[] },
): Promise<AllergenCheck[]> {
  try {
    const tool = (await getProductTools()).checkAllergens;
    const out = (await tool.execute!({ ids, ...constraints }, {})) as { checks?: AllergenCheck[] };
    if (!Array.isArray(out?.checks)) throw new Error('unexpected checkAllergens result');
    return out.checks;
  } catch (err) {
    if (!checkFallbackWarned) {
      checkFallbackWarned = true;
      console.warn(`[aimo-products] checkAllergens over MCP failed (${(err as Error).message}); using the in-process check`);
    }
    return checkAllergens(ids, constraints);
  }
}
