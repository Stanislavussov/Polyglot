/**
 * Notification Repository Port.
 */
export type NotificationType = "srs" | "suggested" | "both";

export interface NotificationUser {
  userId: number;
  telegramId: number;
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  timezone: string;
  notificationEnabled: boolean;
  notificationTime: string;
  notificationType: NotificationType;
}

export interface NotificationRepository {
  getUsersForWindow(hour: number, minute?: number): Promise<NotificationUser[]>;
  getInactiveUsers(): Promise<NotificationUser[]>;
  disableNotifications(userId: number): Promise<void>;
  recordSentWord(userId: number, original: string, source: string): Promise<void>;
  getRecentSentWords(userId: number, limit?: number): Promise<string[]>;
  updatePrefs(
    userId: number,
    prefs: { notificationEnabled?: boolean; notificationTime?: string; notificationType?: NotificationType },
  ): Promise<void>;
}
