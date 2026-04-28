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
  getUsersForWindow(hour: number): Promise<NotificationUser[]>;
  getInactiveUsers(): Promise<NotificationUser[]>;
  disableNotifications(userId: number): Promise<void>;
  updateLastNotified(userId: number, timestamp: Date): Promise<void>;
  updatePrefs(
    userId: number,
    prefs: { notificationEnabled?: boolean; notificationTime?: string; notificationType?: NotificationType },
  ): Promise<void>;
}
