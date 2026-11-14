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

/** Shown when a turn tries to put a second question card under one message. */
export const ONE_QUESTION_NOTE =
  'Not shown: this message already asks the buyer one question (one question card per message). Wait for their answer, then ask the next missing detail.';

/**
 * One question card per buyer turn (offerChoices / askDiets), so the chat asks one thing at a time: a tool checks
 * questionAsked before showing a card and calls markQuestionAsked once it has shown one in this request.
 */
export const questionAsked = (requestContext: RequestContext | undefined) => !!requestContext?.get('questionAsked');
export const markQuestionAsked = (requestContext: RequestContext | undefined) => { requestContext?.set('questionAsked', true); };
