export type SrsRating = "again" | "hard" | "good" | "easy";

export interface SrsState {
  easeFactor: number;
  interval: number;
  reviewCount: number;
  dueDate: Date | null;
}

export interface SrsReviewResult extends Omit<SrsState, "dueDate"> {
  rating: SrsRating;
  dueDate: Date;
}
