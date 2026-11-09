import { api } from "./api";
import { settings } from "./settings-store";

export type PushPermission = "granted" | "denied" | "default";

/** What the app shell does on open for an installed app still delivering to Telegram. */
export type AutoSwitchAction = "subscribe" | "offer" | "none";

export interface AutoSwitchInput {
  standalone: boolean;
  supported: boolean;
  pushAvailable: boolean;
  notificationsEnabled: boolean;
  channel: "bot" | "web";
  permission: PushPermission;
  dismissed: boolean;
}

/**
 * The owner's rule: an installed app takes over reminders the learner already gets, once per device.
 * With permission granted it switches silently; otherwise it asks once with a button,
 * because iOS lets only a tap open the permission prompt.
 */
export function decideAutoSwitch(input: AutoSwitchInput): AutoSwitchAction {
  if (!input.standalone || !input.supported || !input.pushAvailable) return "none";
  // `dismissed` also covers "chose Telegram": without it every open of the app undid that choice.
  if (!input.notificationsEnabled || input.channel !== "bot" || input.dismissed) return "none";
  if (input.permission === "granted") return "subscribe";
  if (input.permission === "default") return "offer";
  return "none";
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushPermission(): PushPermission {
  return pushSupported() ? Notification.permission : "denied";
}

/** The VAPID key arrives base64url-encoded; `subscribe` wants the raw bytes. */
export function urlB64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64Url}${"=".repeat((4 - (base64Url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

/**
 * Asks for permission when needed (call from a tap), subscribes this device and
 * stores the subscription. Resolves false when the learner declines.
 */
export async function subscribeThisDevice(publicKey: string, auto: boolean): Promise<boolean> {
  if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(publicKey),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false;
  settings.value = await api.pushSubscribe({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    auto,
  });
  return true;
}

const DISMISS_KEY = "polyglot.push.offerDismissed";
const SWITCHED_KEY = "polyglot.push.switchNoticeShown";

// Storage can throw (private mode, blocked site data); the banner then simply asks again next time.
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Not persisted: at worst the learner sees the banner or notice once more.
  }
}

export const offerDismissed = (): boolean => readFlag(DISMISS_KEY);
export const dismissOffer = (): void => writeFlag(DISMISS_KEY);
export const switchNoticeShown = (): boolean => readFlag(SWITCHED_KEY);
export const markSwitchNoticeShown = (): void => writeFlag(SWITCHED_KEY);
