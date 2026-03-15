import type { TranslationRequest, TranslationResult } from "./types.js";
import { buildTranslationPrompt } from "./prompt.builder.js";

/** Pure business-logic translation service (no platform dependencies) */
export class TranslationService {
  /** Build the prompt for a translation request */
  buildPrompt(request: TranslationRequest): string {
    return buildTranslationPrompt(request);
  }

  /** Parse a raw AI response into a structured TranslationResult */
  parseResponse(
    request: TranslationRequest,
    rawResponse: string,
  ): TranslationResult {
    return {
      original: request.text,
      translated: rawResponse.trim(),
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
    };
  }
}
