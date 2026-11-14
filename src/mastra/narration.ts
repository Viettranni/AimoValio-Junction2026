// The orchestrator sometimes "thinks aloud" before a tool call ("Buyer already said no add-ons, so plan directly.").
// That text must never reach the buyer. Enforced in code: text written in a step that goes on to call a tool is dropped;
// only text from steps without tool calls (the reply after the tool results) is shown.

type Chunk = { type: string };

const TEXT = new Set(['text-start', 'text-delta', 'text-end']);
const TOOL = new Set(['tool-input-start', 'tool-input-available', 'tool-input-delta']);
const FLUSH = new Set(['finish-step', 'finish', 'error', 'abort']);

/**
 * UI message stream filter: holds a step's text until the step ends. A tool call in the same step discards it;
 * the end of a step without one releases it. Everything else (data parts, tool parts, reasoning) passes through.
 */
export function suppressPreToolText<T extends Chunk>(): TransformStream<T, T> {
  let held: T[] = [];
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      if (TEXT.has(chunk.type)) { held.push(chunk); return; }
      if (TOOL.has(chunk.type)) held = [];
      if (FLUSH.has(chunk.type)) { held.forEach((c) => controller.enqueue(c)); held = []; }
      controller.enqueue(chunk);
    },
    flush(controller) {
      held.forEach((c) => controller.enqueue(c));
    },
  });
}

interface StepLike { text?: string; toolCalls?: unknown[] }

/** generate() result → the text of the steps that called no tool (the buyer-facing reply). */
export function buyerFacingText(result: { text?: string; steps?: StepLike[] }): string {
  if (!result.steps?.length) return (result.text ?? '').trim();
  return result.steps.filter((s) => !s.toolCalls?.length).map((s) => (s.text ?? '').trim()).filter(Boolean).join(' ').trim();
}
