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
  settingsAdapter,
  translationRequestRepository,
  translationTemplateRepository,
  userRepository,
  vocabularyRepository,
  wordReviewRepository,
} from "@polyglot/adapter-db";
import { type ServiceContainer, SettingsService } from "@polyglot/core";

/**
 * Creates the full service container from adapter implementations.
 *
 * This function is called once at bot startup to wire up all dependencies.
 * The resulting container is injected into the bot context.
 */
export function createContainer(): ServiceContainer {
  const settings = new SettingsService(settingsAdapter);
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
    settings,
  } as unknown as ServiceContainer;
  return container;
}
