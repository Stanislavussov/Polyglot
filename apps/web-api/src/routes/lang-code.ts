import type { WebServices } from "../services.js";

export function langCode(services: WebServices, langId: number): string {
  return services.languageCache.getAllLangs().find((lang) => lang.id === langId)?.code ?? "";
}
