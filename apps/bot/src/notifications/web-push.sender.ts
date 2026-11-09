import type { WebPushSender } from "@polyglot/core";
import webpush, { type PushSubscription, type RequestOptions } from "web-push";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** All three or nothing: a half-configured pair would sign pushes no browser accepts. */
export function readVapidConfig(env: NodeJS.ProcessEnv): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

type SendNotification = (subscription: PushSubscription, payload: string, options: RequestOptions) => Promise<unknown>;

const PERMANENT_STATUSES = new Set([400, 403, 404, 410, 413]);

export function createWebPushSender(
  vapid: VapidConfig,
  sendNotification: SendNotification = webpush.sendNotification,
): WebPushSender {
  const options: RequestOptions = {
    vapidDetails: vapid,
    // A reminder older than a day is noise, not news.
    TTL: 24 * 60 * 60,
    timeout: 10_000,
  };
  return {
    async send(subscription, payload) {
      try {
        await sendNotification(subscription, payload, options);
        return "ok";
      } catch (err) {
        // 404/410: the install is gone (app removed, permission revoked). 400/403/413 never pass on
        // retry either (bad subscription, VAPID key mismatch after a rotation); kept as "retry" they
        // left the learner on web with every reminder failing and no Telegram fallback.
        if (err instanceof webpush.WebPushError && PERMANENT_STATUSES.has(err.statusCode)) return "gone";
        throw err;
      }
    },
  };
}
