import type { ToolStream } from '@mastra/core/tools';
import type { Actor, AimoDataPart, Lang, ProgressEvent, ProgressStepId } from '@/contracts';
import { appendAudit } from '@/db/repo';
import { t, uiLangFor } from '@/ui/i18n';

/** Sends one data part to the UI stream. Progress parts are transient (not stored in history). */
export type Emit = (part: AimoDataPart) => Promise<void>;

export const noEmit: Emit = async () => {};

export function emitterFor(writer: ToolStream | undefined): Emit {
  if (!writer) return noEmit;
  return (part) => writer.custom({ ...part, transient: part.type === 'data-progress' });
}

export function progress(
  emit: Emit, lang: Lang | undefined, step: ProgressStepId, status: ProgressEvent['status'],
  extra: Pick<ProgressEvent, 'count' | 'ticker'> = {},
): Promise<void> {
  return emit({ type: 'data-progress', data: { step, status, label: t(`step.${step}`, uiLangFor(lang)), ...extra } });
}

export function audit(conversationId: string, actor: Actor, action: string, summary: string, data?: unknown): void {
  appendAudit({ conversationId, actor, action, summary, data });
}
