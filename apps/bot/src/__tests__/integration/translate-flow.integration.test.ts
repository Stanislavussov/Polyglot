/**
 * Translate happy path — grammY e2e integration test (Task 71, Phase 4).
 *
 * Drives a plain text message through the real translate pipeline against a real
 * Postgres branch, with a DETERMINISTIC AI injected via DI (not vi.mock). The AI
 * mock returns schema-shaped fixtures by matching each requested Zod schema, so it
 * satisfies every pipeline step (preflight → metadata + per-language generation →
 * finalize) without hardcoding call order. Vocabulary is persisted only when the
 * user taps SAVE, so the test asserts the DB row after dispatching the
 * `tr:save:<cardMsgId>` callback, and asserts the outbound card payload.
 *
 * NOTE: this exercises the full multi-step AI pipeline; the fixtures below follow
 * the verified schema contract (translation.service.ts). Runs against any
 * migrated+seeded Postgres (CI service container, local docker, or a Neon branch).
 */
import { languageRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

describe("translate happy path (integration)", () => {
  it("translates a word, renders a save card, and persists vocab on save", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    // Arrange: an onboarded user learning Czech, native English, translate mode.
    const userId = await arrangeOnboardedTranslator(id);

    // Act 1: send a plain word → the translate pipeline renders a card. The card
    // is sent as text and its keyboard is attached via a separate
    // editMessageReplyMarkup, so both the id and the buttons come from that call.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    const { messageId: cardMsgId, buttons } = lastRenderedCard(harness.sent);
    expect(buttons).toContain(`tr:save:${cardMsgId}`);

    // Act 2: tap SAVE → the vocab row is persisted.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    const en = await languageRepository.findByCode("en");
    if (!en) throw new Error("expected seeded language 'en'");
    const saved = await vocabularyRepository.findByOriginalAndSource(userId, "hello", en.id);
    expect(saved).not.toBeNull();
    expect(saved?.original).toBe("hello");
    // The saved-card confirmation is emitted (either an edit of the card or a reply).
    expect(harness.sent.some((c) => c.method === "sendMessage" || c.method === "editMessageText")).toBe(true);
  });
});
