/**
 * The motivation kill switch is read on every recorded effort and every rendered
 * surface, so it goes through the same 60 s cache as the other config groups.
 * That caching is operationally load-bearing: flipping a switch during an
 * incident takes effect within a TTL, not on the next request.
 */
import { describe, expect, it, vi } from "vitest";
import type { SettingsPort } from "../../../ports/settings.port.js";
import type { MotivationConfig } from "../../momentum/momentum.types.js";
import { SettingsService } from "../settings.service.js";

const ALL_ON: MotivationConfig = {
  recordingEnabled: true,
  enabled: true,
  praiseEnabled: true,
  recoveryEnabled: true,
};

describe("SettingsService.getMotivationConfig", () => {
  it("serves the port's config verbatim — the adapter already validated it", async () => {
    const port = { getMotivationConfig: vi.fn().mockResolvedValue(ALL_ON) } as unknown as SettingsPort;

    await expect(new SettingsService(port).getMotivationConfig()).resolves.toEqual(ALL_ON);
  });

  it("does not re-read the switch on every call", async () => {
    // Without the cache this would be a database round-trip per recorded effort.
    const getMotivationConfig = vi.fn().mockResolvedValue(ALL_ON);
    const service = new SettingsService({ getMotivationConfig } as unknown as SettingsPort);

    await service.getMotivationConfig();
    await service.getMotivationConfig();

    expect(getMotivationConfig).toHaveBeenCalledTimes(1);
  });
});
