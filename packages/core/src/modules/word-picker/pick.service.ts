/**
 * Word-picker service — one angle plus one learner turns into one word set.
 * Pure core logic; the AI function is injected.
 */

import type { GenerateObjectFn } from "../../ports/ai.port.js";
import { normalizeWord } from "./normalize.js";
import { buildWordPickPrompt } from "./pick.prompt.js";
import { pickResultSchema } from "./pick.schema.js";
import type { PickedItem, PickResult, WordPickRequest } from "./types.js";

/** Rough output-token budget per item (item + translation + example pair + note). */
const TOKENS_PER_ITEM = 220;
const MIN_OUTPUT_TOKENS = 3072;

export interface PickWordsDeps {
  generateObjectFn: GenerateObjectFn;
  modelId: string;
}

/**
 * Generate one set for an angle, with everything the learner has already seen
 * removed. The "already seen" list is a prompt hint *and* a hard post-filter:
 * the whole feature is worthless if tapping "more" returns the same eight words.
 */
export async function pickWords(request: WordPickRequest, deps: PickWordsDeps): Promise<PickedItem[]> {
  const prompt = buildWordPickPrompt(request);
  const maxTokens = Math.max(MIN_OUTPUT_TOKENS, request.count * TOKENS_PER_ITEM);

  const result = await deps.generateObjectFn<PickResult>(prompt, pickResultSchema, deps.modelId, { maxTokens });

  const seen = new Set(request.knownWords.map(normalizeWord));
  const fresh: PickedItem[] = [];
  for (const item of result.items) {
    const key = normalizeWord(item.word);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
    if (fresh.length >= request.count) break;
  }
  return fresh;
}
