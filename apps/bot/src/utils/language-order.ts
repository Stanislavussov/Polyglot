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
import { type LanguageOrderContext, languageOrderFromSettings, logEvent } from "@polyglot/core";
import { getRequestSettings } from "../middlewares/request-settings.js";
import type { BotContext } from "../types.js";

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
 *
 * The id comes from a foreign key into `languages`, so `undefined` is never
 * ordinary: it means the registry is missing a row it is pointing at. The card
 * degrades quietly (a `🔤` headword, a translation that drops to a note), so the
 * log line is the only thing that says why.
 */
export function makeLangCodeResolver(ctx: BotContext): (id: number) => string | undefined {
  return (id) => {
    const code = ctx.services.languageCache.getAllLangs().find((l) => l.id === id)?.code;
    if (code === undefined) {
      logEvent(
        "language.id_unresolved",
        { langId: id, registrySize: ctx.services.languageCache.getAllLangs().length },
        "warn",
      );
    }
    return code;
  };
}
