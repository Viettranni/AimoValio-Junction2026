import { createAnthropic } from '@ai-sdk/anthropic';
import type { MastraModelConfig, SystemMessage } from '@mastra/core/llm';
import { stallGuardFetch } from './stall-guard';

/**
 * Model for every agent. Default Claude Opus 5.5; set AIMO_MODEL to switch to another Mastra model-router string,
 * e.g. "openai/<model>" with OPENAI_API_KEY set.
 */
export const MODEL_ID = process.env.AIMO_MODEL?.trim() || 'anthropic/claude-opus-5-5';
export const IS_ANTHROPIC = MODEL_ID.startsWith('anthropic/');

/** No progress from the model for this long aborts the call (see stall-guard.ts). */
const MODEL_IDLE_MS = Number(process.env.AIMO_MODEL_IDLE_MS) || 60_000;

/**
 * Anthropic models go through the AI SDK provider directly so their requests get the stall guard;
 * any other provider is resolved by Mastra's model router from the string.
 */
export const MODEL: MastraModelConfig = IS_ANTHROPIC
  // The provider's v4 model type and Mastra's structural copy of it differ only in their declared return types.
  ? (createAnthropic({ fetch: stallGuardFetch(MODEL_IDLE_MS) })(MODEL_ID.slice('anthropic/'.length)) as unknown as MastraModelConfig)
  : MODEL_ID;

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
