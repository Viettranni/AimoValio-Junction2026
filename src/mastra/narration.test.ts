import { describe, expect, it } from 'vitest';
import { buyerFacingText, suppressPreToolText } from './narration';

type C = { type: string; delta?: string };
async function run(chunks: C[]): Promise<C[]> {
  const out: C[] = [];
  const stream = new ReadableStream<C>({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } }).pipeThrough(suppressPreToolText<C>());
  for await (const c of stream as unknown as AsyncIterable<C>) out.push(c);
  return out;
}
const text = (delta: string): C[] => [{ type: 'text-start' }, { type: 'text-delta', delta }, { type: 'text-end' }];

describe('suppressPreToolText', () => {
  it('drops text written before a tool call in the same step and keeps the reply after the tool results', async () => {
    const out = await run([
      { type: 'start' }, { type: 'start-step' }, ...text('Buyer already said no add-ons, so plan directly.'),
      { type: 'tool-input-start' }, { type: 'tool-input-available' }, { type: 'data-progress' }, { type: 'tool-output-available' }, { type: 'finish-step' },
      { type: 'start-step' }, ...text('Your draft is ready: about €900 excl. VAT.'), { type: 'finish-step' }, { type: 'finish' },
    ]);
    const deltas = out.filter((c) => c.type === 'text-delta').map((c) => c.delta);
    expect(deltas).toEqual(['Your draft is ready: about €900 excl. VAT.']);
    expect(out.map((c) => c.type)).toContain('data-progress');
    expect(out.at(-1)?.type).toBe('finish');
  });

  it('keeps a plain reply and releases held text when the stream ends early', async () => {
    expect((await run([{ type: 'start-step' }, ...text('Hi!'), { type: 'finish-step' }])).filter((c) => c.type === 'text-delta')).toHaveLength(1);
    expect((await run(text('cut off'))).filter((c) => c.type === 'text-delta')).toHaveLength(1);
  });
});

describe('buyerFacingText', () => {
  it('returns only the text of steps without tool calls', () => {
    expect(buyerFacingText({
      text: 'Planning directly. Your draft is ready.',
      steps: [{ text: 'Planning directly.', toolCalls: [{}] }, { text: 'Your draft is ready.', toolCalls: [] }],
    })).toBe('Your draft is ready.');
    expect(buyerFacingText({ text: ' Hello ' })).toBe('Hello');
  });
});
