/**
 * Technical-message cleanup — specifically its interaction with the persistent
 * main-menu keyboard.
 *
 * Telegram binds a reply keyboard to the message that delivered it, so deleting
 * that message takes the menu off the user's screen. Cleanup runs before every
 * translation, which is how the menu used to vanish after a single use; if the
 * carrier is ever swept up again, delivery must re-arm instead of failing silently.
 */
import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAIN_KEYBOARD_VERSION } from "../middlewares/main-keyboard.js";
import type { SessionData } from "../types.js";
import { cleanupTechnicalMessages } from "./message-cleanup.js";

type CleanupCtx = Context & { session: SessionData };

const deleteMessage = vi.fn().mockResolvedValue(true);

function createCtx(session: Partial<SessionData>): CleanupCtx {
  return {
    chat: { id: 555 },
    api: { deleteMessage },
    session: { activeMode: "translate", ...session } as SessionData,
  } as unknown as CleanupCtx;
}

describe("cleanupTechnicalMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes tracked messages and leaves the main-menu keyboard installed", async () => {
    const ctx = createCtx({
      technicalMessages: [10, 11],
      mainKeyboardVersion: MAIN_KEYBOARD_VERSION,
      mainKeyboardMessageId: 9,
    });

    await cleanupTechnicalMessages(ctx);

    expect(deleteMessage).toHaveBeenCalledTimes(2);
    expect(deleteMessage).not.toHaveBeenCalledWith(555, 9);
    expect(ctx.session.mainKeyboardVersion).toBe(MAIN_KEYBOARD_VERSION);
    expect(ctx.session.mainKeyboardMessageId).toBe(9);
    expect(ctx.session.technicalMessages).toEqual([]);
  });

  it("re-arms keyboard delivery when the carrier message is swept up", async () => {
    const ctx = createCtx({
      technicalMessages: [9, 10],
      mainKeyboardVersion: MAIN_KEYBOARD_VERSION,
      mainKeyboardMessageId: 9,
    });

    await cleanupTechnicalMessages(ctx);

    expect(ctx.session.mainKeyboardVersion).toBeUndefined();
    expect(ctx.session.mainKeyboardMessageId).toBeUndefined();
  });
});
