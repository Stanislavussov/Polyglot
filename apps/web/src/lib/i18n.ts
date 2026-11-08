import { shallowRef } from "vue";

type Messages = Record<string, string>;

const FALLBACK_LANG = "en";

// Lazy per-language chunks: a learner downloads only English and their own language.
const loaders = import.meta.glob<Messages>(["../i18n/generated/*.json", "!../i18n/generated/en.json"], {
  import: "default",
});
// English ships in the main bundle so the page still reads as text when settings fail to load.
const bundledEnglish = import.meta.glob<Messages>("../i18n/generated/en.json", { import: "default", eager: true });

const current = shallowRef<Messages>({});
const english = bundledEnglish[`../i18n/generated/${FALLBACK_LANG}.json`] ?? {};
export const lang = shallowRef(FALLBACK_LANG);

async function load(code: string): Promise<Messages> {
  if (code === FALLBACK_LANG) return english;
  const loader = loaders[`../i18n/generated/${code}.json`];
  return loader ? await loader() : {};
}

export async function setLang(code: string): Promise<void> {
  const selected = await load(code);
  current.value = selected;
  lang.value = Object.keys(selected).length > 0 ? code : FALLBACK_LANG;
  document.documentElement.lang = lang.value;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const template = current.value[key] ?? english[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(params[name] ?? placeholder));
}
