/**
 * Settings callback handlers — set:* callbacks.
 * Manages native/learning/interface language pickers and close.
 */
import { getLangDisplay, getSupportedLangs, userRepository } from "@polyglot/adapter-db";
import { isSupported, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { setUserCommands } from "../../commands/commands.js";
import { MAX_LEARNING_LANGS } from "../../constants.js";
import type { BotContext } from "../../types.js";
import { buildSettingsKeyboard, buildSettingsText } from "../settings.scene.js";

/** Resolve interface language from user settings */
async function getLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return (isSupported(iLang) ? iLang : "en") as SupportedLang;
}

/** Re-render the settings main menu (after a change or back navigation) */
async function showSettingsMenu(ctx: BotContext): Promise<void> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  const text = buildSettingsText(
    settings?.nativeLang ?? "en",
    settings?.learningLangs ?? [],
    settings?.interfaceLang ?? "en",
    lang,
  );
  const kb = buildSettingsKeyboard(lang);
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
}

/** set:native — show native language picker */
export async function handleSetNativeCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const kb = new InlineKeyboard();
  for (const l of getSupportedLangs()) {
    kb.text(getLangDisplay(l.code), `set:native:${l.code}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();

  await ctx.editMessageText(t("settingsChooseNative", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** set:native:{code} — select a native language */
export async function handleSetNativeSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const code = data.replace("set:native:", "");
  const lang = await getLang(ctx);

  await userRepository.updateNativeLang(ctx.user.id, code);
  await ctx.answerCallbackQuery({
    text: t("settingsNativeUpdated", lang, { lang: getLangDisplay(code) }),
  });
  await showSettingsMenu(ctx);
}

/** set:learning — show learning language multi-select */
export async function handleSetLearningCallback(ctx: BotContext): Promise<void> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const selected = settings?.learningLangs ?? [];

  const kb = buildLearningKeyboard(selected, nativeLang, lang);
  await ctx.editMessageText(t("settingsChooseLearning", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** Build multi-select keyboard for learning languages */
function buildLearningKeyboard(selected: string[], nativeLang: string, lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const l of getSupportedLangs()) {
    if (l.code === nativeLang) continue;
    const isSelected = selected.includes(l.code);
    const prefix = isSelected ? "✅ " : "";
    kb.text(`${prefix}${getLangDisplay(l.code)}`, `set:learn:${l.code}`).row();
  }
  if (selected.length > 0) {
    kb.text(t("done", lang), "set:learn:done").row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();
  return kb;
}

/** set:learn:{code} — toggle a learning language */
export async function handleSetLearnToggleCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const code = data.replace("set:learn:", "");

  if (code === "done") {
    return handleSetLearnDoneCallback(ctx);
  }

  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const selected = [...(settings?.learningLangs ?? [])];

  const idx = selected.indexOf(code);
  if (idx >= 0) {
    selected.splice(idx, 1);
    await ctx.answerCallbackQuery({
      text: t("langRemoved", lang, { lang: getLangDisplay(code) }),
    });
  } else if (selected.length >= MAX_LEARNING_LANGS) {
    await ctx.answerCallbackQuery({
      text: t("maxLangsReached", lang, { max: MAX_LEARNING_LANGS }),
      show_alert: true,
    });
    return;
  } else {
    selected.push(code);
    await ctx.answerCallbackQuery({
      text: t("langAdded", lang, { lang: getLangDisplay(code) }),
    });
  }

  // Persist intermediate state so it's kept across callbacks
  await userRepository.updateLearningLangs(ctx.user.id, selected);

  const kb = buildLearningKeyboard(selected, nativeLang, lang);
  await ctx.editMessageReplyMarkup({ reply_markup: kb });
}

/** set:learn:done — confirm learning language selection */
async function handleSetLearnDoneCallback(ctx: BotContext): Promise<void> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const selected = settings?.learningLangs ?? [];

  if (selected.length === 0) {
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery({
      text: t("selectAtLeastOne", lang),
      show_alert: true,
    });
    return;
  }

  const lang = await getLang(ctx);
  await ctx.answerCallbackQuery({ text: t("settingsLearningUpdated", lang) });
  await showSettingsMenu(ctx);
}

/** set:interface — show interface language picker */
export async function handleSetInterfaceCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const kb = new InlineKeyboard();
  for (const l of getSupportedLangs()) {
    kb.text(getLangDisplay(l.code), `set:iface:${l.code}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();

  await ctx.editMessageText(t("settingsChooseInterface", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** set:iface:{code} — select an interface language */
export async function handleSetIfaceSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const code = data.replace("set:iface:", "");

  await userRepository.updateInterfaceLang(ctx.user.id, code);

  // Use the NEW interface language for the confirmation
  const newLang = (isSupported(code) ? code : "en") as SupportedLang;
  await ctx.answerCallbackQuery({
    text: t("settingsInterfaceUpdated", newLang, { lang: getLangDisplay(code) }),
  });

  // Update bot commands for the user's new language
  const chatId = ctx.from?.id;
  if (chatId) {
    await setUserCommands(ctx.api, chatId, newLang);
  }

  await showSettingsMenu(ctx);
}

/** set:back — return to settings main menu */
export async function handleSetBackCallback(ctx: BotContext): Promise<void> {
  await showSettingsMenu(ctx);
  await ctx.answerCallbackQuery();
}

/** set:close — dismiss the settings menu */
export async function handleSetCloseCallback(ctx: BotContext): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch {
    // Message might be too old to delete — just remove keyboard
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  }
  await ctx.answerCallbackQuery();
}
