/**
 * Notification template repository port — the user's choice of what an opened word notification shows.
 */
import type { NotificationTemplateFields } from "../shared/notification-template.types.js";

export interface NotificationTemplateRepository {
  /** The saved choice, or `DEFAULT_NOTIFICATION_TEMPLATE_FIELDS` for a user who never changed it. */
  getFields(userId: number): Promise<NotificationTemplateFields>;
  /** Persist one toggle and return the full resulting choice. */
  setField(
    userId: number,
    field: keyof NotificationTemplateFields,
    enabled: boolean,
  ): Promise<NotificationTemplateFields>;
}
