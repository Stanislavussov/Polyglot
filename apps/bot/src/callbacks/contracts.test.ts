import { describe, expect, it } from "vitest";
import {
  callbackContracts,
  getCallbackDataByteLength,
  isValidTelegramCallbackData,
  MAX_TELEGRAM_CALLBACK_DATA_BYTES,
} from "./contracts.js";

describe("callback restart-safety contracts", () => {
  it("documents all required callback families", () => {
    const families = new Set(callbackContracts.map((contract) => contract.family));

    expect(families).toEqual(
      new Set([
        "translation",
        "flashcard",
        "srs",
        "dictionary",
        "template",
        "settings",
        "notification",
        "subscription",
      ]),
    );
  });

  it("keeps documented maximum callback_data examples within Telegram's 64-byte limit", () => {
    for (const contract of callbackContracts) {
      expect(getCallbackDataByteLength(contract.maxExampleData), contract.maxExampleData).toBeLessThanOrEqual(
        MAX_TELEGRAM_CALLBACK_DATA_BYTES,
      );
      expect(isValidTelegramCallbackData(contract.maxExampleData), contract.maxExampleData).toBe(true);
    }
  });
});
