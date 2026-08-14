/**
 * Hook demo cards (Task 72, slices 4/5).
 *
 * The onboarding payoff screen must be **instant**: p50 for a live translation is
 * ~7 s and p95 ~23 s, which is not a first impression. So the three curated
 * headwords per learning language are rendered ahead of time by the warm-up
 * script and served from `onboarding_demo_cards` — the tap path touches no AI
 * adapter at all. A miss falls back to the real pipeline (with the normal loader)
 * and the result is written back, so the second user of that pair is instant too.
 *
 * Only reviewed rows (`is_active = true`) are ever returned by the repository —
 * these cards are the first thing a new user sees.
 */
import { classifyInput, getHookWords, logger, type SupportedLang } from "@polyglot/core";
import { buildTranslationKeyboard, renderTranslation } from "../renderers/translation.renderer.js";
import { setTranslationEntry } from "../scenes/helpers/translation-map.helper.js";
import type { BotContext } from "../types.js";
import { resolveLanguageOrder } from "../utils/language-order.js";

/**
 * Upper bound on hook buttons across all learning languages. Three headwords ×
 * four languages would be a twelve-button wall; the words are distributed
 * round-robin so every learning language is represented before any language
 * gets a second entry.
 */
export const MAX_DEMO_HOOKS = 6;

export interface DemoHook {
  sourceLang: string;
  /** Index into that language's curated list — what the callback data carries. */
  index: number;
  headword: string;
}

/**
 * Curated hook words for the user's learning languages, round-robin across
 * languages and capped at {@link MAX_DEMO_HOOKS}.
 */
export function getHookWordsForLangs(learningLangs: readonly string[]): DemoHook[] {
  const perLang = learningLangs.map((code) => ({ code, words: getHookWords(code) }));
  const longest = perLang.reduce((max, entry) => Math.max(max, entry.words.length), 0);
  const hooks: DemoHook[] = [];

  for (let index = 0; index < longest && hooks.length < MAX_DEMO_HOOKS; index++) {
    for (const { code, words } of perLang) {
      if (hooks.length >= MAX_DEMO_HOOKS) break;
      const word = words[index];
      if (word) hooks.push({ sourceLang: code, index, headword: word.headword });
    }
  }

  return hooks;
}

/** Resolve the headword a `onb:hook:<lang>:<index>` callback refers to. */
export function resolveHookWord(sourceLang: string, index: number): string | null {
  return getHookWords(sourceLang)[index]?.headword ?? null;
}

/**
 * Render a cached demo card as a real translation card — same renderer, same
 * inline keyboard, same session entry as the production translate flow, so its
 * buttons work exactly like every other card the user will ever see.
 *
 * Returns false when no active cached card exists for the pair; the caller then
 * falls back to the live pipeline.
 */
export async function sendCachedDemoCard(
  ctx: BotContext,
  opts: { sourceLang: string; headword: string; nativeLang: string; interfaceLang: SupportedLang },
): Promise<boolean> {
  const cached = await ctx.services.onboardingDemoCardRepository.findOne(
    opts.sourceLang,
    opts.nativeLang,
    opts.headword,
  );
  if (!cached) return false;

  const output = cached.payload;
  // The demo card's payload is stored as jsonb, so its translation keys come back
  // alphabetized. Order is taken from the user's saved settings rather than
  // onboarding state, keeping this re-derived from the DB on every update.
  const body = renderTranslation(
    output,
    await resolveLanguageOrder(ctx),
    opts.interfaceLang,
    undefined,
    opts.nativeLang,
    false,
  );
  const cardMsg = await ctx.reply(body, { parse_mode: "HTML" });

  const keyboard = buildTranslationKeyboard(opts.interfaceLang, cardMsg.message_id, false);
  await ctx.api.editMessageReplyMarkup(ctx.chat!.id, cardMsg.message_id, { reply_markup: keyboard });

  if (ctx.session) {
    ctx.session.pendingTranslation = output;
    ctx.session.pendingCardMsgId = cardMsg.message_id;
    setTranslationEntry(ctx.session, cardMsg.message_id, {
      output,
      inputType: classifyInput(opts.headword).type,
    });
  }

  logger.info(
    { userId: ctx.user?.id, sourceLang: opts.sourceLang, headword: opts.headword },
    "Onboarding demo card served from cache",
  );
  return true;
}

/**
 * Write a freshly generated demo card back to the cache after a miss. Best
 * effort: a failure here must never break the user's onboarding, so it is logged
 * and swallowed. The row lands with `is_active = false` — it is served only once
 * a human has reviewed it.
 *
 * The payload is taken from `session.pendingTranslation`, which the translate
 * flow sets when it renders a card. That is only the card we asked for if the
 * pipeline actually produced one: a clarification or out-of-set branch returns
 * without rendering, leaving whatever was there before. So the output is matched
 * against the requested headword before it is cached — otherwise a curated hook
 * word could end up cached with a completely unrelated translation.
 */
export async function cacheDemoCard(
  ctx: BotContext,
  opts: { sourceLang: string; headword: string; nativeLang: string; sortOrder: number },
): Promise<void> {
  const output = ctx.session?.pendingTranslation;
  if (!output) return;
  if (output.original !== opts.headword || output.sourceLang !== opts.sourceLang) {
    logger.info(
      { expected: opts.headword, got: output.original, userId: ctx.user?.id },
      "Onboarding demo card not cached — the pipeline did not render the requested headword",
    );
    return;
  }
  try {
    await ctx.services.onboardingDemoCardRepository.upsert({
      sourceLang: opts.sourceLang,
      nativeLang: opts.nativeLang,
      headword: opts.headword,
      payload: output,
      sortOrder: opts.sortOrder,
    });
  } catch (err) {
    logger.warn({ err, ...opts }, "Failed to cache onboarding demo card");
  }
}
