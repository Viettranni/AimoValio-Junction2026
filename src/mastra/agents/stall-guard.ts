// A model response that stops making progress must fail fast instead of hanging the buyer's turn.
// Seen live: Anthropic streams that sent their headers, then nothing but keep-alive pings for 14–17 minutes
// before the connection was dropped. Node's fetch only times out on silence, and pings aren't silence.
// This fetch wrapper aborts a streamed request when no meaningful SSE event (anything but `ping`) arrives for
// `idleMs` (the headers included), and a non-streamed one (its headers come with the whole answer) after
// `2 × idleMs`. The SDK then reports an error: specialists fall back (e.g. the best search match), and the chat
// shows its retry button.

const PING_ONLY = /^event:\s*ping\s*$/;

export class ModelStallError extends Error {
  constructor(idleMs: number) {
    super(`The model sent no progress for ${Math.round(idleMs / 1000)} s; request aborted`);
    this.name = 'ModelStallError';
  }
}

/** True when an SSE chunk contains an event other than `ping` (or data without an event line). */
export function hasProgress(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const l = line.trim();
    if (!l) return false;
    if (l.startsWith('event:')) return !PING_ONLY.test(l);
    if (l.startsWith('data:')) return !l.includes('"type":"ping"');
    return false;
  });
}

export function stallGuardFetch(idleMs: number, base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const outer = init?.signal;
    if (outer?.aborted) controller.abort(outer.reason);
    const onOuterAbort = () => controller.abort(outer?.reason);
    outer?.addEventListener('abort', onOuterAbort, { once: true });

    const streamed = typeof init?.body === 'string' && /"stream"\s*:\s*true/.test(init.body);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fail: (err: Error) => void = (err) => controller.abort(err);
    const arm = (ms = idleMs) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const err = new ModelStallError(ms);
        console.warn(`[model] ${err.message}`);
        fail(err);
      }, ms);
    };
    const disarm = () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    };

    arm(streamed ? idleMs : 2 * idleMs);
    let res: Response;
    try {
      res = await base(input, { ...init, signal: controller.signal });
    } catch (err) {
      disarm();
      throw controller.signal.reason instanceof ModelStallError ? controller.signal.reason : err;
    }
    if (!res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      // A plain JSON body arrives in one go once the headers are here.
      disarm();
      return res;
    }
    arm();
    const decoder = new TextDecoder();
    let pending = '';
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        fail = (err) => {
          try { c.error(err); } catch { /* already closed */ }
          controller.abort(err);
          void reader.cancel(err).catch(() => {});
        };
      },
      async pull(c) {
        try {
          const { done, value } = await reader.read();
          if (done) { disarm(); c.close(); return; }
          // Events can straddle chunks; keep the unfinished last line for the next one.
          pending += decoder.decode(value, { stream: true });
          const cut = pending.lastIndexOf('\n');
          if (cut >= 0) {
            if (hasProgress(pending.slice(0, cut))) arm();
            pending = pending.slice(cut + 1);
          }
          c.enqueue(value);
        } catch (err) {
          disarm();
          const reason = controller.signal.reason;
          try { c.error(reason instanceof ModelStallError ? reason : err); } catch { /* already errored */ }
        }
      },
      cancel(reason) {
        disarm();
        return reader.cancel(reason);
      },
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}
