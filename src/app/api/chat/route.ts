import { handleChatStream, withSseHeartbeat } from '@mastra/ai-sdk';
import { RequestContext } from '@mastra/core/request-context';
import { createUIMessageStreamResponse } from 'ai';
import { z } from 'zod';
import { mastra } from '@/mastra';
import { suppressPreToolText } from '@/mastra/narration';
import { failure, parseBody } from '../http';

export const maxDuration = 120;

const bodySchema = z.object({
  // Shape is validated by the AI SDK; the cast bridges @mastra/ai-sdk's bundled v7 message types.
  messages: z.array(z.custom<never>((m) => typeof m === 'object' && m !== null)).min(1),
  conversationId: z.string().min(1),
  customerId: z.string().min(1).default('helsinki-juhlapalvelu'),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, bodySchema);
  if ('error' in parsed) return parsed.error;
  const { messages, conversationId, customerId } = parsed.data;
  try {
    const requestContext = new RequestContext();
    requestContext.set('conversationId', conversationId);
    requestContext.set('customerId', customerId);
    const stream = await handleChatStream({
      mastra, agentId: 'orchestrator', version: 'v7',
      params: { messages, requestContext },
      onError: (error) => {
        console.error(error);
        return 'Sorry, something went wrong on my side. Please try again.';
      },
    });
    // Pre-tool narration never reaches the buyer (see src/mastra/narration.ts).
    return withSseHeartbeat(createUIMessageStreamResponse({ stream: stream.pipeThrough(suppressPreToolText()) }), 15000);
  } catch (e) {
    return failure(e);
  }
}
