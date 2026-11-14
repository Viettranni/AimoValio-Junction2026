// Who is calling an MCP tool: HTTP passes the bearer key as authInfo (src/mcp/http.ts); stdio uses AIMO_AGENT_KEY.
// The customer always comes from the key, never from tool input.
import type { RequestContext } from '@mastra/core/request-context';
import { resolveAgent } from '@/gateway/agents';
import type { AgentIdentity } from '@/gateway/types';

type AuthInfo = { token?: string } | undefined;
export interface ToolCallContext {
  mcp?: { extra?: { authInfo?: AuthInfo } };
  requestContext?: Pick<RequestContext, 'get'>;
}

export function agentFor(context: ToolCallContext | undefined): AgentIdentity {
  const authInfo = context?.mcp?.extra?.authInfo ?? (context?.requestContext?.get('authInfo') as AuthInfo);
  return resolveAgent(authInfo?.token ?? process.env.AIMO_AGENT_KEY);
}
