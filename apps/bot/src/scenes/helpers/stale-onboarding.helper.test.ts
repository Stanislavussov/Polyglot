import { describe, expect, it, vi } from "vitest";
import type { BotContext } from "../../types.js";
import { handleStaleOnboardingCallback } from "./stale-onboarding.helper.js";

/**
 * Pure unit test (no DB) for the stale-onboarding recovery handler — the fix for
 * the 2026-08-01 incident where a dead onboarding conversation left `lang:`
 * buttons unresponsive.
 */
function makeCtx(user: { id: number; onboarded: boolean } | undefined) {
  const answerCallbackQuery = vi.fn(async () => true);
  const enter = vi.fn(async () => undefined);
  const ctx = {
    callbackQuery: { data: "lang:de" },
    user,
    answerCallbackQuery,
    conversation: { enter },
  } as unknown as BotContext;
  return { ctx, answerCallbackQuery, enter };
}

describe("handleStaleOnboardingCallback", () => {
  it("acknowledges the tap and re-enters onboarding for a not-yet-onboarded user", async () => {
    const { ctx, answerCallbackQuery, enter } = makeCtx({ id: 7, onboarded: false });

    await handleStaleOnboardingCallback(ctx);

    // The spinner is cleared instead of hanging...
    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    // ...and the user is dropped back into a fresh onboarding.
    expect(enter).toHaveBeenCalledWith("onboarding");
  });

  it("only clears the spinner for an already-onboarded user (no re-entry)", async () => {
    const { ctx, answerCallbackQuery, enter } = makeCtx({ id: 7, onboarded: true });

    await handleStaleOnboardingCallback(ctx);

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(enter).not.toHaveBeenCalled();
  });

  it("does not re-enter onboarding when there is no resolved user", async () => {
    const { ctx, answerCallbackQuery, enter } = makeCtx(undefined);

    await handleStaleOnboardingCallback(ctx);

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(enter).not.toHaveBeenCalled();
  });
});
