import { shallowRef } from "vue";

type Messages = Record<string, string>;

const FALLBACK_LANG = "en";

// Lazy per-language chunks: a learner downloads only English and their own language.
const loaders = import.meta.glob<Messages>("../i18n/generated/*.json", { import: "default" });

const current = shallowRef<Messages>({});
const fallback = shallowRef<Messages>({});
export const lang = shallowRef(FALLBACK_LANG);

async function load(code: string): Promise<Messages> {
  const loader = loaders[`../i18n/generated/${code}.json`];
  return loader ? await loader() : {};
}

export async function setLang(code: string): Promise<void> {
  const [english, selected] = await Promise.all([load(FALLBACK_LANG), load(code)]);
  fallback.value = english;
  current.value = selected;
  lang.value = Object.keys(selected).length > 0 ? code : FALLBACK_LANG;
  document.documentElement.lang = lang.value;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const template = current.value[key] ?? fallback.value[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(params[name] ?? placeholder));
}
