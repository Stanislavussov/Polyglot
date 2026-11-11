import type { InjectionKey, Ref } from "vue";

// Sizes come only from the type scale in @docs/agents/web-design.md.
export type IconColumn = "sm" | "md" | "lg";
export type HeadlineSize = "md" | "lg" | "xl";
export type LineSize = "sm" | "base" | "xl";
export type Tone = "ink" | "primary" | "muted";

export const ICON_COLUMN: Record<IconColumn, string> = { sm: "min-w-5", md: "min-w-6", lg: "min-w-9" };

export const HEADLINE_TEXT: Record<HeadlineSize, string> = {
  md: "text-xl font-semibold leading-7",
  lg: "text-2xl font-semibold leading-8",
  xl: "text-3xl font-bold leading-9",
};
export const HEADLINE_EMOJI: Record<HeadlineSize, string> = {
  md: "text-2xl leading-7",
  lg: "text-2xl leading-8",
  xl: "text-3xl leading-9",
};

export const LINE_TEXT: Record<LineSize, string> = { sm: "text-sm", base: "text-base", xl: "text-xl font-semibold" };

export const TONE: Record<Tone, string> = { ink: "text-ink", primary: "text-primary", muted: "text-ink-muted" };

/** Every IconRow inside one WordCard reads this, so emoji and flags share one column. */
export const ICON_COLUMN_KEY: InjectionKey<Ref<IconColumn>> = Symbol("word-card-icon-column");
