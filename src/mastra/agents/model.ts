import type { SystemMessage } from '@mastra/core/llm';

/**
 * Model for every agent, as a Mastra model-router string. Default Claude Opus 5.5; set AIMO_MODEL to switch,
 * e.g. "openai/<model>" with OPENAI_API_KEY set.
 */
export const MODEL = process.env.AIMO_MODEL?.trim() || 'anthropic/claude-opus-5-5';
export const IS_ANTHROPIC = MODEL.startsWith('anthropic/');

/** Opus 5.5 always thinks; effort is the speed lever (@ai-sdk/anthropic `effort`). Only sent to Anthropic models. */
export function effort(level: 'low' | 'medium') {
  return IS_ANTHROPIC ? { providerOptions: { anthropic: { effort: level } } } : {};
}

/** A stable system prompt, marked for Anthropic prompt caching when the model is Anthropic's. */
export function cachedSystem(content: string): SystemMessage {
  return IS_ANTHROPIC
    ? { role: 'system', content, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
    : { role: 'system', content };
}
