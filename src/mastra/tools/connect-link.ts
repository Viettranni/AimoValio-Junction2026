import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { connectInfo } from '@/gateway/connect';
import { getAimoContext } from '../context';
import { audit, emitterFor } from '../events';

/** Shows the buyer the copy-paste MCP link for Claude as a card with a copy button. */
export const shareConnectLinkTool = createTool({
  id: 'shareConnectLink',
  description:
    'Show the buyer a card with the link that connects Claude (or another AI assistant) to Valio Aimo over MCP, with a Copy button. ' +
    'Use it when the buyer asks how to use Aimo from Claude, ChatGPT or another assistant, for the MCP link, or to connect their calendar through Claude.',
  inputSchema: z.object({}),
  outputSchema: z.object({ shown: z.literal(true), isPublic: z.boolean() }),
  execute: async (_input, context) => {
    const { conversationId } = getAimoContext(context.requestContext);
    const { mcpUrl, localMcpUrl, isPublic } = connectInfo(null);
    await emitterFor(context.writer)({ type: 'data-connect', data: { mcpUrl, localMcpUrl, isPublic } });
    audit(conversationId, 'orchestrator', 'shareConnectLink', `Shared the ${isPublic ? 'public' : 'local'} MCP link`);
    return { shown: true as const, isPublic };
  },
});
