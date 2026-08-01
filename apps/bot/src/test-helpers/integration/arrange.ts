/**
 * Shared arrange helpers for the bot e2e integration lane (Task 71).
 */
import { userRepository } from "@polyglot/adapter-db";

/**
 * Provision an onboarded user in translate mode (interface/native English,
 * learning Czech) and return its domain id. Used by the translate happy-path and
 * callback-regression e2e tests, which all need a user the translate flow will
 * route to.
 */
export async function arrangeOnboardedTranslator(telegramId: number): Promise<number> {
  const user = await userRepository.create({ telegramId, username: "translator" });
  await userRepository.markOnboarded(user.id);
  await userRepository.updateSettings(user.id, {
    interfaceLang: "en",
    nativeLang: "en",
    learningLangs: ["cs"],
    lastSourceLang: null,
  });
  await userRepository.updateActiveMode(user.id, "translate");
  return user.id;
}
