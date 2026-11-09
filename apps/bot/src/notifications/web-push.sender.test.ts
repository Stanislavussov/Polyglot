import { describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { createWebPushSender, readVapidConfig } from "./web-push.sender.js";

const VAPID = { publicKey: "pub", privateKey: "priv", subject: "mailto:ops@example.com" };
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p", auth: "a" } };

function pushError(statusCode: number): Error {
  return new webpush.WebPushError("push failed", statusCode, {}, "", SUB.endpoint);
}

describe("readVapidConfig", () => {
  it("returns null unless all three values are set", () => {
    expect(readVapidConfig({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toBeNull();
    expect(readVapidConfig({})).toBeNull();
  });

  it("reads a complete configuration", () => {
    expect(
      readVapidConfig({
        VAPID_PUBLIC_KEY: " pub ",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:ops@example.com",
      }),
    ).toEqual(VAPID);
  });
});

describe("createWebPushSender", () => {
  it("signs with the VAPID keys and reports ok", async () => {
    const send = vi.fn(async () => ({}));
    await expect(createWebPushSender(VAPID, send).send(SUB, "{}")).resolves.toBe("ok");
    expect(send).toHaveBeenCalledWith(SUB, "{}", expect.objectContaining({ vapidDetails: VAPID }));
  });

  it.each([400, 403, 404, 410, 413])("reports a %i as gone", async (status) => {
    const send = vi.fn(async () => {
      throw pushError(status);
    });
    await expect(createWebPushSender(VAPID, send).send(SUB, "{}")).resolves.toBe("gone");
  });

  it("throws any other failure so the scheduler retries", async () => {
    const send = vi.fn(async () => {
      throw pushError(503);
    });
    await expect(createWebPushSender(VAPID, send).send(SUB, "{}")).rejects.toBeInstanceOf(webpush.WebPushError);
  });
});
