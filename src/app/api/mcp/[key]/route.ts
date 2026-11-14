// The same MCP endpoint with the agent key in the path: POST /api/mcp/<key>. Claude's custom connectors take only a URL,
// and a path survives where a query string may not. The key is read from the URL by src/mcp/http.ts.
import { handleMcpRequest } from '@/mcp/http';
import { aimoGatewayServer } from '@/mcp/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const handle = (req: Request) => handleMcpRequest(req, aimoGatewayServer);
export { handle as GET, handle as POST, handle as DELETE };
