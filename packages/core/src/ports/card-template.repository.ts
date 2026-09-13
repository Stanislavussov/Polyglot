/**
 * Card template repository port — the user's choice of what a review card's front shows.
 */
import type { CardFrontFields } from "../shared/card-template.types.js";

export interface CardTemplateRepository {
  /** The saved choice, or `DEFAULT_CARD_FRONT_FIELDS` for a user who never changed it. */
  getFields(userId: number): Promise<CardFrontFields>;
  /** Persist one toggle and return the full resulting choice. */
  setField(userId: number, field: keyof CardFrontFields, enabled: boolean): Promise<CardFrontFields>;
}
