import { shallowRef } from "vue";
import { api } from "./api";
import { lang, setLang } from "./i18n";
import type { NotificationPatch, Settings, SettingsPatch } from "./types";
import { unlistedLanguageName } from "./unlisted-language";

export const settings = shallowRef<Settings | null>(null);

// The last settings, so a repeat visit renders the real page at once instead of a loader
// that is swapped out (and blinks) when the server answers; the server's copy still wins.
const CACHE_KEY = "settings";

async function apply(next: Settings): Promise<void> {
  settings.value = next;
  await setLang(next.interfaceLang || "en");
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // Storage off: every visit waits for the server, as before.
  }
}

/** True when cached settings were applied and the page can render before the server answers. */
export async function restoreSettings(): Promise<boolean> {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (typeof cached !== "object" || cached === null || !("interfaceLang" in cached)) return false;
    settings.value = cached as Settings;
    await setLang((cached as Settings).interfaceLang || "en");
    return true;
  } catch {
    return false;
  }
}

export function forgetSettings(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // nothing cached
  }
}

export async function loadSettings(): Promise<void> {
  await apply(await api.settings());
}

export async function saveSettings(patch: SettingsPatch): Promise<void> {
  await apply(await api.updateSettings(patch));
}

export async function saveNotifications(patch: NotificationPatch): Promise<void> {
  settings.value = await api.updateNotifications(patch);
}

export function languageName(code: string): string {
  return (
    settings.value?.languages.find((language) => language.code === code)?.name ?? unlistedLanguageName(code, lang.value)
  );
}

export function languageFlag(code: string): string {
  return settings.value?.languages.find((language) => language.code === code)?.flag ?? "";
}

// English is always on offer as a source, as core's answer check allows it.
export function isOwnLanguage(code: string): boolean {
  const current = settings.value;
  return !current || code === "en" || code === current.nativeLang || current.learningLangs.includes(code);
}
