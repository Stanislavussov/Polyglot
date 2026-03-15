import type { TranslationRequest } from "./types.js";

/** Builds an AI prompt for a translation request */
export function buildTranslationPrompt(request: TranslationRequest): string {
  const topicHint = request.topic
    ? ` The context/topic is: ${request.topic}.`
    : "";

  return [
    `Translate the following text from ${request.sourceLang} to ${request.targetLang}.${topicHint}`,
    `Provide the main translation and up to 3 alternative translations if applicable.`,
    ``,
    `Text: "${request.text}"`,
  ].join("\n");
}
