// The orchestrator sometimes "thinks aloud" before a work tool call ("Buyer already said no add-ons, so plan directly.").
// That text must never reach the buyer. Enforced in code: text written in a step that goes on to call a WORK tool
// (understandRequest, planOrder, editDraft, checkIn, and the lookups) is dropped. offerChoices is different: its question text
// ("What's your budget?") IS the reply and is kept, as is text in steps without tool calls.

type Chunk = { type: string; toolName?: string };

/** Tools that do work after which the orchestrator writes its real reply; text before them is narration. */
export const WORK_TOOLS: ReadonlySet<string> = new Set([
  'understandRequest', 'planOrder', 'editDraft', 'checkIn', 'readDraft', 'lookupProducts', 'draftDirectOrder', 'refreshPrices',
  'logWaste', 'wasteReport', 'findPastOrders', 'draftFromPastOrder',
]);

const TEXT = new Set(['text-start', 'text-delta', 'text-end']);
const TOOL_START = new Set(['tool-input-start', 'tool-input-available']);
const FLUSH = new Set(['finish-step', 'finish', 'error', 'abort']);

/**
 * UI message stream filter: holds a step's text until the step ends or a tool call starts. A work tool call discards it;
 * any other tool call (offerChoices) or the end of the step releases it. Everything else passes through.
 */
export function suppressPreToolText<T extends Chunk>(): TransformStream<T, T> {
  let held: T[] = [];
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      if (TEXT.has(chunk.type)) { held.push(chunk); return; }
      if (TOOL_START.has(chunk.type)) {
        if (!WORK_TOOLS.has(chunk.toolName ?? '')) held.forEach((c) => controller.enqueue(c));
        held = [];
      }
      if (FLUSH.has(chunk.type)) { held.forEach((c) => controller.enqueue(c)); held = []; }
      controller.enqueue(chunk);
    },
    flush(controller) {
      held.forEach((c) => controller.enqueue(c));
    },
  });
}

type ToolCallLike = { toolName?: string; payload?: { toolName?: string } };
interface StepLike { text?: string; toolCalls?: ToolCallLike[] }

const callsWorkTool = (s: StepLike) => (s.toolCalls ?? []).some((c) => WORK_TOOLS.has(c.payload?.toolName ?? c.toolName ?? ''));

/** generate() result → the buyer-facing text: steps that called no work tool (replies, offerChoices questions). */
export function buyerFacingText(result: { text?: string; steps?: StepLike[] }): string {
  if (!result.steps?.length) return (result.text ?? '').trim();
  return result.steps.filter((s) => !callsWorkTool(s)).map((s) => (s.text ?? '').trim()).filter(Boolean).join(' ').trim();
}
