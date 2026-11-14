import { describe, expect, it } from 'vitest';
import { hasProgress, ModelStallError, stallGuardFetch } from './stall-guard';

const enc = new TextEncoder();
const sse = (...events: string[]) => events.map((e) => `event: ${e}\ndata: {"type":"${e}"}\n\n`).join('');

/** A fake fetch whose SSE body is written by the test. */
function fakeStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const fetchFn = (async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
  return { fetchFn, push: (t: string) => controller.enqueue(enc.encode(t)), end: () => controller.close() };
}

/** A fake fetch that never answers until aborted. */
const hanging = ((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
})) as unknown as typeof fetch;

const STREAMED = { method: 'POST', body: '{"stream":true}' };

describe('hasProgress', () => {
  it('ignores pings and blank lines', () => {
    expect(hasProgress('event: ping\ndata: {"type":"ping"}\n')).toBe(false);
    expect(hasProgress('\n\n')).toBe(false);
  });
  it('counts content events', () => {
    expect(hasProgress('event: content_block_delta\ndata: {"type":"content_block_delta"}\n')).toBe(true);
    expect(hasProgress('event: ping\n\nevent: message_stop\n')).toBe(true);
  });
});

describe('stallGuardFetch', () => {
  it('passes a healthy stream through unchanged', async () => {
    const s = fakeStream();
    const res = await stallGuardFetch(200, s.fetchFn)('https://x', STREAMED);
    const text = res.text();
    s.push(sse('message_start', 'content_block_delta'));
    s.push(sse('message_stop'));
    s.end();
    expect(await text).toBe(sse('message_start', 'content_block_delta', 'message_stop'));
  });

  it('aborts a stream that only sends pings', async () => {
    const s = fakeStream();
    const res = await stallGuardFetch(60, s.fetchFn)('https://x', STREAMED);
    const text = res.text();
    s.push(sse('message_start'));
    const pinger = setInterval(() => s.push(sse('ping')), 10);
    try {
      await expect(text).rejects.toBeInstanceOf(ModelStallError);
    } finally {
      clearInterval(pinger);
    }
  });

  it('aborts a request whose headers never come', async () => {
    await expect(stallGuardFetch(20, hanging)('https://x', STREAMED)).rejects.toBeInstanceOf(ModelStallError);
  });

  it('gives a non-streamed request twice as long', async () => {
    const started = Date.now();
    await expect(stallGuardFetch(30, hanging)('https://x', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(ModelStallError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it("keeps the caller's own abort", async () => {
    const ac = new AbortController();
    const p = stallGuardFetch(1000, hanging)('https://x', { method: 'POST', body: '{}', signal: ac.signal });
    ac.abort(new Error('user stop'));
    await expect(p).rejects.toThrow('user stop');
  });
});
