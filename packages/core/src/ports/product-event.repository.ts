/**
 * Port interface for the Product Event Repository.
 *
 * Product events answer "what do people actually do here" — who reached the
 * paywall, who picked a plan, who paid, which features get used and which get
 * refused. That is a different question from the technical event stream in
 * `@docs/agents/observability.md`, which answers "what did the process do".
 * Loki can only be grepped and its records expire with the container's log
 * horizon; these rows aggregate in SQL and render in the admin panel.
 *
 * Two columns carry everything on purpose: a closed `event` vocabulary and a
 * short `context` string drawn from an already-bounded set (a plan name, a
 * feature key, a command, a mode). No jsonb payload — a free-form blob is what
 * turns a product-metrics table into an unqueryable landfill.
 *
 * Only the write path is part of the DI contract; the aggregate reads live in
 * the admin surface and use the adapter directly, as with language detection.
 */

/**
 * The closed event vocabulary. Adding a member here is the whole cost of
 * tracking something new — the table, the retention sweep and the admin
 * aggregates are all generic over it.
 */
export const PRODUCT_EVENTS = [
  /** The plan comparison was opened. `context`: the feature that gated, or `cta` / `settings`. */
  "paywall.shown",
  /** A plan button was tapped on that screen. `context`: plan name. */
  "plan.selected",
  /** Checkout succeeded and the subscription is live. `context`: plan name. */
  "plan.confirmed",
  /** The user backed out at the confirmation step. `context`: unset — the button carries no plan. */
  "plan.canceled",
  /** A purchase was refused as a same-or-cheaper switch. `context`: target plan name. */
  "plan.downgrade_blocked",
  /** A paid feature was used by someone entitled to it. `context`: feature key. */
  "feature.used",
  /** A paid feature was refused for want of a plan. `context`: feature key. */
  "feature.locked",
  /** A usage ceiling was hit. `context`: `translation` or `video`. */
  "limit.reached",
  /** A slash command ran. `context`: command name, without the slash. */
  "command.used",
  /** The chat switched text-routing mode. `context`: the mode switched INTO. */
  "mode.switched",
] as const;

export type ProductEvent = (typeof PRODUCT_EVENTS)[number];

export interface RecordProductEventInput {
  /** Absent only for an update that never resolved to a user (pre-auth failure). */
  userId?: number;
  event: ProductEvent;
  /** Short discriminator; see the per-event notes above. */
  context?: string;
  /** The user's plan AT THE TIME of the event — the funnel needs who they were, not who they became. */
  plan?: string;
}

export interface ProductEventRepository {
  record(input: RecordProductEventInput): Promise<void>;
}
