/**
 * Notification Repository Port.
 */
export type NotificationType = "srs" | "suggested" | "contextual";

export interface NotificationUser {
  userId: number;
  telegramId: number;
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  timezone: string;
  notificationEnabled: boolean;
  notificationTimes: string[];
  notificationType: NotificationType;
  notificationContext: string | null;
}

export interface NotificationRepository {
  getUsersForWindow(hour: number, minute?: number): Promise<NotificationUser[]>;
  getInactiveUsers(): Promise<NotificationUser[]>;
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
