import { describe, expect, it } from "vitest";
import { type AutoSwitchInput, decideAutoSwitch, urlB64ToUint8Array } from "./push";

const installed: AutoSwitchInput = {
  standalone: true,
  supported: true,
  pushAvailable: true,
  notificationsEnabled: true,
  channel: "bot",
  permission: "granted",
  dismissed: false,
};

describe("decideAutoSwitch", () => {
  it("switches silently when the installed app already may notify", () => {
    expect(decideAutoSwitch(installed)).toBe("subscribe");
  });

  it("offers a button while permission was never asked", () => {
    expect(decideAutoSwitch({ ...installed, permission: "default" })).toBe("offer");
  });

  it("never switches again once the learner chose Telegram on this device", () => {
    expect(decideAutoSwitch({ ...installed, dismissed: true })).toBe("none");
  });

  it("stops offering once the learner said not now", () => {
    expect(decideAutoSwitch({ ...installed, permission: "default", dismissed: true })).toBe("none");
  });

  it.each<[string, Partial<AutoSwitchInput>]>([
    ["a browser tab", { standalone: false }],
    ["a browser without push", { supported: false }],
    ["a server without push keys", { pushAvailable: false }],
    ["reminders turned off", { notificationsEnabled: false }],
    ["reminders already on the web", { channel: "web" }],
    ["permission denied", { permission: "denied" }],
  ])("does nothing for %s", (_case, change) => {
    expect(decideAutoSwitch({ ...installed, ...change })).toBe("none");
  });
});

describe("urlB64ToUint8Array", () => {
  it("decodes unpadded base64url", () => {
    expect([...urlB64ToUint8Array("-_8")]).toEqual([0xfb, 0xff]);
  });
});
