import type { RequestContext } from '@mastra/core/request-context';

/** Set by the chat route on every request. */
export type AimoContext = { conversationId: string; customerId: string };

export function getAimoContext(requestContext: RequestContext | undefined): AimoContext {
  const conversationId = requestContext?.get('conversationId');
  const customerId = requestContext?.get('customerId');
  if (typeof conversationId !== 'string' || !conversationId || typeof customerId !== 'string' || !customerId) {
    throw new Error('Missing conversationId/customerId in the request context');
  }
  return { conversationId, customerId };
}
