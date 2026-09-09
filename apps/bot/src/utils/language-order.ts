/**
 * Builds the language-ordering context every render surface needs.
 *
 * Display order follows the user's own learning-language order (native first),
 * and it is derived at render time rather than stored — see
 * `@polyglot/core`'s translation-order module for why neither object key order
 * nor row order can carry it.
 *
 * Prefer {@link languageOrderFromSettings} wherever the handler has already
 * loaded settings; several dictionary handlers call `getSettings` twice per
 * render already, and this should not add a third.
 *
 * **Never return a context from `conversation.external()`.** It holds a `Map`
 * keyed by a symbol, so it does not survive the replay serialization grammY
 * conversations perform — fetch the plain settings across that boundary and build
 * the context on this side.
 */
import { createLanguageOrderContext, type LanguageOrderContext } from "@polyglot/core";
import { getRequestSettings } from "../middlewares/request-settings.js";
import type { BotContext } from "../types.js";

/** Settings shape needed for ordering — a subset of the user's language settings. */
interface LanguageSettings {
  nativeLang?: string | null;
  learningLangs?: string[] | null;
}

/**
 * Build the ordering context from settings already in hand.
 *
 * A missing settings row yields an empty context, which ranks everything by
 * language code. That is correct for a user who has chosen nothing yet, and it
 * is the same order the bug produced — so surfaces are covered by tests that
 * assert a non-alphabetical result for a user who *has* chosen languages.
 */
export function languageOrderFromSettings(settings: LanguageSettings | null | undefined): LanguageOrderContext {
  return createLanguageOrderContext({
    nativeLang: settings?.nativeLang,
    learningLangs: settings?.learningLangs ?? [],
  });
}

/**
 * Load the user's settings and build the ordering context.
 *
 * Goes through the request-scoped memo, so adding ordering to a render path that
 * already resolved settings during this update costs no extra query. Never read
 * `ctx.user.settings` — it is always undefined in this bot.
 */
export async function resolveLanguageOrder(ctx: BotContext): Promise<LanguageOrderContext> {
  return languageOrderFromSettings(await getRequestSettings(ctx, ctx.user.id));
}

/**
 * Resolve a `languages.id` to its ISO 639-1 code.
 *
 * Ordering DB-backed translation rows needs this, since rows carry ids while the
 * user's preference is stored as codes.
 */
export function makeLangCodeResolver(ctx: BotContext): (id: number) => string | undefined {
  return (id) => ctx.services.languageCache.getAllLangs().find((l) => l.id === id)?.code;
}
