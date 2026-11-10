import { shallowRef } from "vue";
import { api } from "./api";
import { setLang } from "./i18n";
import type { NotificationPatch, Settings, SettingsPatch } from "./types";

export const settings = shallowRef<Settings | null>(null);

async function apply(next: Settings): Promise<void> {
  settings.value = next;
  await setLang(next.interfaceLang || "en");
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
  return settings.value?.languages.find((language) => language.code === code)?.name ?? code;
}

export function languageFlag(code: string): string {
  return settings.value?.languages.find((language) => language.code === code)?.flag ?? "";
}
