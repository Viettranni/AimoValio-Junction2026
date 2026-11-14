// Remote MCP endpoint of the agent gateway (Streamable HTTP): POST /api/mcp with `Authorization: Bearer <agent key>`.
// Same server, tools and policy as the stdio entry (src/mcp/stdio.ts). See docs/CONNECT.md.
import { handleMcpRequest } from '@/mcp/http';
import { aimoGatewayServer } from '@/mcp/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const handle = (req: Request) => handleMcpRequest(req, aimoGatewayServer);
export { handle as GET, handle as POST, handle as DELETE };
