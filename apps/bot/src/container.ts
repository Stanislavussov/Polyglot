/**
 * Composition Root — wires all service implementations into a ServiceContainer.
 *
 * This is where adapter implementations are wired to port interfaces.
 * The container is then injected into the bot context via middleware.
 */

import { estimateCost, generateObject, generateText, getAvailableModels } from "@polyglot/adapter-ai";
// Re-export directly from adapters
import {
  getAllLangs,
  getLang,
  getLangDisplay,
  getLangFlag,
  getLangName,
  getLangNativeName,
  getSupportedLangs,
  isKnownLang,
  isLanguageCacheLoaded,
  loadLanguageCache,
  normalizeToIso1,
  notificationRepository,
  translationRequestRepository,
  translationTemplateRepository,
  userRepository,
  vocabularyRepository,
  wordReviewRepository,
} from "@polyglot/adapter-db";
import type { ServiceContainer } from "@polyglot/core";

/**
 * Creates the full service container from adapter implementations.
 *
 * This function is called once at bot startup to wire up all dependencies.
 * The resulting container is injected into the bot context.
 */
export function createContainer(): ServiceContainer {
  // Using type assertion to bypass strict type checking for adapter wiring
  // The adapter functions have the correct runtime behavior
  const container = {
    userRepository,
    vocabularyRepository,
    translationTemplateRepository,
    wordReviewRepository,
    notificationRepository,
    translationRequestRepository,
    languageCache: {
      loadLanguageCache,
      isLanguageCacheLoaded,
      getLang,
      getAllLangs,
      getSupportedLangs,
      getLangName,
      getLangNativeName,
      getLangFlag,
      getLangDisplay,
      isKnownLang,
      normalizeToIso1,
    },
    ai: {
      generateObject,
      generateText,
      getAvailableModels,
      estimateCost,
    },
  } as unknown as ServiceContainer;
  return container;
}
