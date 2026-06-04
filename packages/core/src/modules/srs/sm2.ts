import type { SrsRating, SrsReviewResult, SrsState } from "./types.js";

const MIN_EASE_FACTOR = 1.3;
const DEFAULT_EASE_FACTOR = 2.5;

function addDays(from: Date, days: number): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next;
}

function clampEaseFactor(value: number): number {
  return Math.max(MIN_EASE_FACTOR, Number(value.toFixed(2)));
}

function nextInterval(state: SrsState, rating: SrsRating): number {
  if (rating === "again") return 1;
  if (rating === "hard") return Math.max(1, Math.ceil(Math.max(1, state.interval) * 1.2));
  if (rating === "easy") {
    if (state.reviewCount === 0) return 4;
    return Math.max(1, Math.round(Math.max(1, state.interval) * state.easeFactor * 1.3));
  }
  if (state.reviewCount === 0) return 1;
  if (state.reviewCount === 1) return 6;
  return Math.max(1, Math.round(Math.max(1, state.interval) * state.easeFactor));
}

function nextEaseFactor(state: SrsState, rating: SrsRating): number {
  if (rating === "again") return clampEaseFactor(state.easeFactor - 0.2);
  if (rating === "hard") return clampEaseFactor(state.easeFactor - 0.15);
  if (rating === "easy") return clampEaseFactor(state.easeFactor + 0.15);
  return clampEaseFactor(state.easeFactor);
}

export function initialSrsDueDate(now: Date = new Date()): Date {
  return addDays(now, 1);
}

export function applySm2Review(state: SrsState, rating: SrsRating, now: Date = new Date()): SrsReviewResult {
  const normalized: SrsState = {
    easeFactor: state.easeFactor > 0 ? state.easeFactor : DEFAULT_EASE_FACTOR,
    interval: Math.max(0, state.interval),
    reviewCount: Math.max(0, state.reviewCount),
    dueDate: state.dueDate,
  };
  const interval = nextInterval(normalized, rating);
  return {
    rating,
    easeFactor: nextEaseFactor(normalized, rating),
    interval,
    reviewCount: normalized.reviewCount + 1,
    dueDate: addDays(now, interval),
  };
}
