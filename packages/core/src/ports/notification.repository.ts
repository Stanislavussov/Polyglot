/**
 * Notification Repository Port.
 */
export type NotificationType = "srs" | "suggested" | "contextual";

export interface NotificationUser {
  userId: number;
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  timezone: string;
  notificationEnabled: boolean;
  notificationTimes: string[];
  notificationType: NotificationType;
  notificationContext: string | null;
  /** Re-engagement pings already sent in the current lapse episode (0 while active). */
  reengagementCount: number;
}

export interface NotificationRepository {
  getUsersForWindow(hour: number, minute?: number): Promise<NotificationUser[]>;
  /**
   * Lapsed subscribers whose next re-engagement ping is due — silent past the
   * inactivity threshold, still under the ping cap, and past the spacing interval.
   */
  getUsersForReEngagement(): Promise<NotificationUser[]>;
  /** Stamp a re-engagement ping: advances the count and the spacing clock. */
  recordReEngagement(userId: number): Promise<void>;
  disableNotifications(userId: number): Promise<void>;
  recordSentWord(userId: number, original: string, source: string): Promise<void>;
  /** Original words sent to the user since the given instant (rolling de-dup window). */
  getSentWordsSince(userId: number, since: Date): Promise<string[]>;
  updatePrefs(
    userId: number,
    prefs: {
      notificationEnabled?: boolean;
      notificationTimes?: string[];
      notificationType?: NotificationType;
      notificationContext?: string | null;
    },
  ): Promise<void>;
}
