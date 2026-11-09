/** Where scheduled notifications go: the Telegram chat or the installed web app. */
export type NotificationChannel = "bot" | "web";

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface StoredPushSubscription {
  id: number;
  userId: number;
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export interface PushSubscriptionRepository {
  /** Stores the subscription; an endpoint already known (even for another user) is re-pointed to this one. */
  upsert(input: {
    userId: number;
    endpoint: string;
    keys: PushSubscriptionKeys;
    userAgent?: string | null;
  }): Promise<void>;
  listForUser(userId: number): Promise<StoredPushSubscription[]>;
  countForUser(userId: number): Promise<number>;
  /** Removes the user's subscription for this endpoint; false when there was none. */
  removeForUser(userId: number, endpoint: string): Promise<boolean>;
  remove(id: number): Promise<void>;
  markSuccess(id: number): Promise<void>;
}

/** The push service's verdict: `gone` (404/410) means the subscription is dead and must be dropped. */
export type WebPushResult = "ok" | "gone";

/** Sends one encrypted Web Push message; any failure other than `gone` throws so the caller can retry. */
export interface WebPushSender {
  send(subscription: { endpoint: string; keys: PushSubscriptionKeys }, payload: string): Promise<WebPushResult>;
}
