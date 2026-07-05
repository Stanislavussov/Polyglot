/**
 * Regression tests for the outbound Telegram chat-id resolution used by the
 * notification scheduler (Fable T24 review fix).
 *
 * T24 moved outbound resolution to the `identities` table exclusively, but
 * migration `0044` creates that table without a backfill — so at deploy every
 * existing user, and the whole dormant re-engagement cohort (which never sends
 * an inbound message to self-heal), has no identity row and would be silently
 * skipped. `resolveTelegramChatId` must fall back to the retained legacy
 * `users.telegram_id` column and self-heal an identity on that send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesStub } from "../test-helpers/services-stub.js";
import { resolveTelegramChatId } from "./notification.wiring.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveTelegramChatId", () => {
  it("returns the chat id from the identity port when an identity row exists", async () => {
    const services = createServicesStub();
    vi.mocked(services.identityRepository.findExternalId).mockResolvedValue("555");

    const chatId = await resolveTelegramChatId(1, services);

    expect(chatId).toBe(555);
    // The identity is the source of truth — no legacy read, no heal needed.
    expect(services.userRepository.getTelegramIdById).not.toHaveBeenCalled();
    expect(services.identityRepository.linkIdentity).not.toHaveBeenCalled();
  });

  it("falls back to legacy users.telegram_id and self-heals an identity when no identity row exists", async () => {
    const services = createServicesStub();
    // Dormant/existing user: identities table is empty at the 0044 deploy.
    vi.mocked(services.identityRepository.findExternalId).mockResolvedValue(null);
    vi.mocked(services.userRepository.getTelegramIdById).mockResolvedValue(98_765);

    const chatId = await resolveTelegramChatId(42, services);

    // The notification is still delivered to the legacy chat id.
    expect(chatId).toBe(98_765);
    // ...and the identity row is opportunistically healed for the next send.
    expect(services.identityRepository.linkIdentity).toHaveBeenCalledWith(42, "telegram", "98765");
  });

  it("skips (returns null) only when both the identity and the legacy column are absent", async () => {
    const services = createServicesStub();
    vi.mocked(services.identityRepository.findExternalId).mockResolvedValue(null);
    vi.mocked(services.userRepository.getTelegramIdById).mockResolvedValue(null);

    const chatId = await resolveTelegramChatId(7, services);

    expect(chatId).toBeNull();
    expect(services.identityRepository.linkIdentity).not.toHaveBeenCalled();
  });
});
