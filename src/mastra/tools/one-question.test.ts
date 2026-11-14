import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.AIMO_DB_PATH = ':memory:'; });

import { RequestContext } from '@mastra/core/request-context';
import { offerChoicesTool } from './offer-choices';

const input = { question: 'Budget?', options: [{ id: 'none', label: 'No budget limit' }], multi: false, allowFreeText: true };

function turn() {
  const requestContext = new RequestContext();
  requestContext.set('conversationId', 'c-one-question');
  requestContext.set('customerId', 'helsinki-juhlapalvelu');
  const parts: unknown[] = [];
  const writer = { custom: async (p: unknown) => { parts.push(p); } };
  return { context: { requestContext, writer } as never, parts };
}

describe('one question card per message', () => {
  it('shows the first card of a turn and refuses a second one', async () => {
    const t = turn();
    expect(await offerChoicesTool.execute!(input, t.context)).toMatchObject({ shown: true });
    expect(await offerChoicesTool.execute!({ ...input, question: 'Allergies?' }, t.context)).toMatchObject({ shown: false, note: expect.stringMatching(/one question/) });
    expect(t.parts).toHaveLength(1);
  });

  it('starts fresh on the next turn', async () => {
    const next = turn();
    expect(await offerChoicesTool.execute!(input, next.context)).toMatchObject({ shown: true });
  });
});
