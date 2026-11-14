import { describe, expect, it } from 'vitest';
import type { CheckInEvent, ChoicesEvent, Draft, DraftLine, ProgressEvent } from '@/contracts';
import { describeEdit } from './editNote';
import { deriveThread, type ThreadInput, type ThreadMessage } from './thread';

const choices: ChoicesEvent = {
  id: 'q-budget', question: 'Budget?', options: [{ id: 'none', label: 'No limit' }], multi: false, allowFreeText: true,
};
const checkin: CheckInEvent = {
  orderId: 'VA-1', eventName: 'Wedding', lines: [{ lineId: 'l-1', productName: 'Rice', quantity: 25, unit: 'kg', leftoverQty: -2 }],
};
const step: ProgressEvent = { step: 'search', status: 'start', label: 'Searching' };

const user = (id: string, text: string): ThreadMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const input = (over: Partial<ThreadInput>): ThreadInput => ({
  messages: [], progress: {}, local: [], answers: {}, checkins: {}, ...over,
});

describe('deriveThread', () => {
  it('starts with the greeting', () => {
    expect(deriveThread(input({})).map((i) => i.kind)).toEqual(['greeting']);
  });

  it('puts assistant text before the structured parts the tools emitted earlier', () => {
    const items = deriveThread(input({
      messages: [
        user('u1', 'Wedding'),
        { id: 'a1', role: 'assistant', parts: [{ type: 'data-choices', data: choices }, { type: 'text', text: ' Two things: ' }] },
      ],
    }));
    expect(items.map((i) => i.kind)).toEqual(['greeting', 'user', 'assistant', 'choices']);
    expect(items[2]).toMatchObject({ text: 'Two things:' });
  });

  it('shows the connect link card after the assistant text', () => {
    const connect = { mcpUrl: 'https://x.trycloudflare.com/api/mcp?key=k', localMcpUrl: 'http://localhost:3100/api/mcp?key=k', isPublic: true };
    const items = deriveThread(input({
      messages: [user('u1', 'connect claude'), { id: 'a1', role: 'assistant', parts: [{ type: 'data-connect', data: connect }, { type: 'text', text: 'Paste this.' }] }],
    }));
    expect(items.map((i) => i.kind)).toEqual(['greeting', 'user', 'assistant', 'connect']);
    expect(items[3]).toMatchObject({ event: connect });
  });

  it('drops a reply that is only stray <br> tags', () => {
    const items = deriveThread(input({
      messages: [user('u1', 'a'), { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '<br>\n\n<br>' }, { type: 'text', text: 'Hi<br>there' }] }],
    }));
    expect(items.filter((i) => i.kind === 'assistant').map((i) => (i.kind === 'assistant' ? i.text : ''))).toEqual(['Hi\nthere']);
  });

  it('shows progress under the user turn it belongs to', () => {
    const items = deriveThread(input({
      messages: [user('u1', 'a'), { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] }, user('u2', 'b')],
      progress: { 2: [step] },
    }));
    expect(items.map((i) => i.id)).toEqual(['greet', 'u1', 'a1-0', 'u2', 'u2-progress']);
  });

  it('drops unanswered choices from older assistant messages but keeps answered ones', () => {
    const messages: ThreadMessage[] = [
      user('u1', 'a'),
      { id: 'a1', role: 'assistant', parts: [{ type: 'data-choices', data: choices }] },
      user('u2', 'typed instead'),
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'thanks' }] },
    ];
    expect(deriveThread(input({ messages })).some((i) => i.kind === 'choices')).toBe(false);
    const answered = deriveThread(input({ messages, answers: { 'q-budget': { ids: ['none'] } } }));
    expect(answered.find((i) => i.kind === 'choices')).toMatchObject({ answer: { ids: ['none'] } });
  });

  it('places local notes after the message count they arrived at and applies check-in state', () => {
    const items = deriveThread(input({
      messages: [user('u1', 'a'), { id: 'a1', role: 'assistant', parts: [{ type: 'data-checkin', data: checkin }] }],
      local: [
        { afterCount: 1, item: { id: 'local-1', kind: 'assistant', text: 'note' } },
        { afterCount: 9, item: { id: 'local-2', kind: 'checkin', event: checkin } },
      ],
      checkins: { 'a1-0': { confirmed: true }, 'local-2': { answer: 'fine' } },
    }));
    expect(items.map((i) => i.id)).toEqual(['greet', 'u1', 'local-1', 'a1-0', 'local-2']);
    expect(items[3]).toMatchObject({ confirmed: true });
    expect(items[4]).toMatchObject({ answer: 'fine' });
  });

  it('shows a choice answer once: on the answered card, not again as a user message', () => {
    const messages: ThreadMessage[] = [
      user('u1', 'Wedding'),
      { id: 'a1', role: 'assistant', parts: [{ type: 'data-choices', data: choices }] },
      user('u2', 'about 4000 euros'),
      user('u3', 'about 4000 euros'),
    ];
    const items = deriveThread(input({ messages, answers: { 'q-budget': { ids: [], freeText: 'about 4000 euros' } } }));
    expect(items.map((i) => i.id)).toEqual(['greet', 'u1', 'a1-0', 'u3']);
  });

  it('ends with a retryable error when the chat failed', () => {
    const items = deriveThread(input({ messages: [user('u1', 'a')], errorText: 'Could not reach' }));
    expect(items.at(-1)).toEqual({ id: 'chat-error', kind: 'error', text: 'Could not reach', retry: true });
  });
});

describe('describeEdit', () => {
  const line = (id: string, quantity: number): DraftLine => ({
    id, componentId: `c-${id}`, group: 'poultry_main', productId: id, productName: `Product ${id}`, packDescription: '',
    packs: quantity / 5, quantity, unit: 'kg', unitPrice: 10, unitPriceWithTax: 11.35, tags: [],
    allergen: { productId: id, verdict: 'pass', conflicts: [], unmetDiets: [] }, alternatives: [],
  });
  const draft = (lines: DraftLine[], low: number, high: number): Draft => ({
    id: 'd', conversationId: 'c', customerId: 'x', intake: {}, lines,
    components: [{ id: 'c-a', label: 'Chicken', searchTerms: { fi: '', en: '' }, category: 'poultry_main', origin: 'requested', guests: 1, requiredAmount: 1, requiredUnit: 'kg' }],
    totals: { low, high, lowWithTax: low, highWithTax: high, collapsed: low === high, budget: null, overBudget: false },
    cutoff: null, status: 'ready', updatedAt: '',
  });

  it('echoes quantity changes and removals with the new total', () => {
    const before = draft([line('a', 60), line('b', 10)], 700, 700);
    const after = draft([line('a', 75)], 702, 768);
    const note = describeEdit(before, after, { changedLineIds: ['a'], removedLineIds: ['b'], addedLineIds: [] }, 'en');
    expect(note).toBe('Chicken 60 kg → 75 kg · Product b removed · total €702–€768');
  });

  it('returns null when nothing visible changed', () => {
    const d = draft([line('a', 60)], 600, 600);
    expect(describeEdit(d, d, { changedLineIds: ['a'], removedLineIds: [], addedLineIds: [] }, 'en')).toBeNull();
  });
});
