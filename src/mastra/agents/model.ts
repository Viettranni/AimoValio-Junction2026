import type { SystemMessage } from '@mastra/core/llm';

export const MODEL = 'anthropic/claude-opus-5-5';

/** Opus 5.5 always thinks; effort is the speed lever (@ai-sdk/anthropic `effort` provider option). */
export function effort(level: 'low' | 'medium') {
  return { providerOptions: { anthropic: { effort: level } } };
}

/** A stable system prompt marked for Anthropic prompt caching. */
export function cachedSystem(content: string): SystemMessage {
  return { role: 'system', content, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } };
}
