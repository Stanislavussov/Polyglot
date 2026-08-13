/**
 * Notification log utilities.
 *
 * Emits notification lifecycle events onto the structured event stream.
 */
import { logEvent } from "@polyglot/core";
import type { WordSource } from "./types.js";

/**
 * Log a successfully dispatched notification.
 * Called by the scheduler after each successful send.
 *
 * Supports both BRD §2.5 notification types:
 * - 'suggested': AI-suggested word based on user's saved topics
 * - 'srs': Word from dictionary due for SRS review
 */
export function logNotificationSent(params: { userId: number; type: WordSource; wordId?: number }): void {
  logEvent("notification.sent", params);
}
