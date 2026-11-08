import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** The object the Telegram Login Widget hands its `data-onauth` callback. */
export const telegramLoginSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number().int().positive(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type TelegramLogin = z.infer<typeof telegramLoginSchema>;

/** A login older than this is refused, so a leaked payload cannot be replayed for long. */
export const MAX_LOGIN_AGE_SECONDS = 5 * 60;
/** Tolerated clock skew for an `auth_date` that is slightly in the future. */
const MAX_FUTURE_SKEW_SECONDS = 30;

export type LoginCheck = { ok: true } | { ok: false; reason: "bad_hash" | "expired" | "future" };

/**
 * Telegram's check (core.telegram.org/widgets/login#checking-authorization): the
 * key is SHA-256 of the bot token, the message is every field except `hash`,
 * sorted by key, as `key=value` joined by "\n".
 */
export function verifyTelegramLogin(login: TelegramLogin, botToken: string, nowSeconds: number): LoginCheck {
  const { hash, ...fields } = login;
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key as keyof typeof fields]}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_hash" };
  }
  if (login.auth_date - nowSeconds > MAX_FUTURE_SKEW_SECONDS) return { ok: false, reason: "future" };
  if (nowSeconds - login.auth_date > MAX_LOGIN_AGE_SECONDS) return { ok: false, reason: "expired" };
  return { ok: true };
}
