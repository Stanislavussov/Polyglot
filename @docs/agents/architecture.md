# Architecture Rules

## Layers

- `packages/core` — platform-independent domain logic. Never imports adapters or apps;
  dependencies are injected.
- `packages/adapters/*` — integrations with external systems. No product-workflow logic.
- `packages/infra` — config (`loadConfig()` + Zod), the shared pino logger, scripts. Leaf
  dependency, no business logic.
- `apps/*` — wiring, UI, commands, HTTP routes. Composes core services; no business logic.

`pnpm lint:deps` enforces direction and forbids cycles. Never weaken a dependency-cruiser
rule to pass — extract shared types, inject, or break the cycle.

**Domain values live in the database.** Languages, modes and persisted enums come from the
DB cache or a constant exported by `packages/adapters/db` (`MAX_LEARNING_LANGS`,
`DEFAULT_DICTIONARY_NAME`, `AUDIENCE_GROUPS`, …) — never a hardcoded list or TS union.

## Ports and Adapters

- A port is an interface in `packages/core/src/ports/`, named for what core needs
  (`PaymentRepository`, `HostedPaymentProvider`), never for a vendor.
- An adapter implements one port for one external system. It translates — HTTP, SQL,
  vendor status codes — and decides nothing: no prices, no grants, no retries policy.
- Apps wire adapters into core services in their composition root (`container.ts`,
  `*.wiring.ts`). The bot and the web call the same core service; only the adapter set
  differs per channel.
- Test core through in-memory fakes of its ports; test an adapter against the vendor's
  documented responses at the HTTP boundary.

## Module Contracts

Behavioral invariants, not API surface — read source for signatures.

### AI adapter — `packages/adapters/ai`

- The only module that talks to the AI provider. No domain logic.
- Model and `maxRetries` are inputs, never hardcoded.
- Log every request: model, tokens, `cost_usd`, `duration_ms`.

### DB adapter — `packages/adapters/db`

- The only module that knows Drizzle/Postgres; everyone else goes through repositories.
- CRUD only, Drizzle only (no raw SQL), single `getDb()`, one repository per file.
- A new append-only log table joins `runTelemetryRetention` in the same change.
  `product_events` has its own horizon; `user_momentum` is never pruned.

### Notifications — `packages/adapters/notifications`

- Gets `sendFn` injected; never imports the bot. Log-and-continue on send errors; respect
  the user's timezone.
- **A scheduled notification is a subscription, not a nudge.** It always fires while
  enabled; never suppress it because the user is already active. `INACTIVITY_DAYS = 14` is
  a reachability ceiling, not targeting. Re-engaging users who never subscribed is a
  separate, unbuilt job. (Known tension: `processInactiveUsers` auto-pauses an opt-in
  after 14 days, sending `notifPaused` first.)
- **The `/settings` toggle is the only enable path.** Anything setting
  `notification_enabled = true` must also seed the admin default into an empty
  `notification_times` — an enabled user with an empty schedule never receives anything.
  `userRepository.updateNotificationPrefs` has no production callers and must not become a
  second enable path (knip won't warn: `exports` is off).
- **Word selection is layered and never repeats:** dictionary → editor's word pack → curated
  preset (when the dictionary is empty or exhausted) → empty-dictionary prompt. A lapsed
  user's card puts the pack first (Task 87). A picker with nothing new returns `null`; the
  pack layer never recycles a word. Pack and preset words come from the reviewed demo-card
  cache, else translated just-in-time.
- **A dictionary word is a card** (Task 86): the review-deck picker (due first, one card per
  entry, `notification_batch_size` of them) goes ahead of those layers for every type but
  `contextual`, and every card's word is recorded in the history. Reveal builds the deck on
  the tap and hands the message to the Cards (`fc:*`) handlers — never a second rating flow,
  never a second template. Only a word with no entry stays a prompt that Reveal translates.

### Accounts and sign-in — `packages/core/src/modules/identity`, `packages/adapters/auth`

- **One person, one `users` row, many ways in.** Each way in is an `identities` row
  `(channel, external_id)`. `createAccounts` is the only sign-in rule; the bot's auth
  middleware and every web login call it.
- **Methods join only by proof.** Telegram gives no email, so nothing is matched
  automatically. A signed-in person adds a method in web settings by passing its check
  (Telegram widget, Google ID token).
- **Two existing accounts are never merged.** Linking a method that already opens another
  account answers 409 `taken`; one account holds at most one id per method (`channel_taken`).
  The login page steers bot users to Telegram so they do not create a second account.
- `users.telegram_id` is null for a Google-only account until Telegram is linked; linking
  fills it. Anything that sends a Telegram message must skip rows without it.
- A legacy Telegram row (before `identities`, migration 0044) is found by `telegram_id`
  and its identity row self-heals; the common sign-in path does no write.
- Google: `sub` is the account id, never the email. The verifier checks signature
  (Google JWKS), issuer, expiry and our client id (`GOOGLE_CLIENT_ID`).

### Payments — `packages/core/src/modules/subscriptions`, `packages/adapters/payments`

- **One ledger for every channel.** Bot and web write the same `subscriptions` and
  `payments` tables. A user is one `users` row whatever they log in with (the web logs in
  through Telegram), so a plan bought anywhere is the same entitlement everywhere.
- **Per-channel providers, shared rules.** Telegram ToS: digital goods inside the bot are
  sold for Stars only, and the bot must never link out to the web checkout. The web sells
  by card through Comgate (Czech PSP: no reverse-charge VAT on its fees, so a Czech
  non-VAT-payer stays outside the "identifikovaná osoba" regime). Both reach core through
  ports; neither app decides prices, upgrades or grants.
- `decidePurchase` / `purchasableLadder` are the only upgrade rules; `grantPaidPeriod` is the
  only way a paid month opens.
- **Only a re-fetched charge grants.** A provider notification is a hint (Comgate pushes
  are unsigned): `settle` re-reads the charge, compares the amount to the pending row, and
  claims `pending → paid` once. A grant that throws releases the claim.
- **Renewals repeat the price last paid** and run in the bot's renewal sweep for every
  channel, routed by `subscriptions.provider` (`routeRenewalsByProvider`). The mock renews
  only `provider = "mock"` rows. A network error rethrows — an outage never expires a payer.
- Comgate is off until `COMGATE_MERCHANT` and `COMGATE_SECRET` are set; recurring charges
  stay off until `COMGATE_RECURRING=on`, after Comgate support enables them for the shop.

### Core — `packages/core`

- No AI-provider concerns in core; model selection and retry are explicit inputs.
- **Translation template** (`src/shared`): `DEFAULT_TEMPLATE` is the single source of field
  visibility; presets are immutable; derive `TranslationOutputConfig` only via
  `resolveOutputConfig`.
- **i18n**: text only through `t(key, lang)`; a missing key falls back to `en`, never throws.
- **Validation**: pure functions, one `validate*` per rule returning a failure reason.
- **Translation**: single entry `translate()`; does not persist, knows nothing about the
  user, always validates before returning; language names via `getLangName()`.
- **Topics**: cache-first, batch translation calls.

### Bot — `apps/bot`

- No business logic, no direct DB access. All user-facing text through i18n. One scene per
  file.
- The active mode owns every user turn: typed text and transcribed voice both go through
  `dispatchByActiveMode`. A new input channel reuses it (a reply to a mentor answer is the
  one override).
- **A card front hands over nothing.** Fronts render only through `renderCardFront` — the
  word plus the user's `CardFrontFields`. Meaning, explanation and translation belong to the
  back. `DEFAULT_CARD_FRONT_FIELDS` applies when there is no `user_card_templates` row.
- Never read `ctx.user.settings` — use `getSettings(userId)`.

### Onboarding — `apps/bot/src/onboarding`

- **Stateless.** No grammY conversation, session field or in-memory step state; every screen
  is re-derived from `users.onboarding_step` + language tables. Held state reintroduces the
  wait-timeout, swallowed-message and replayed-session failures.
- Persist each choice the moment it is made. A learning language is written only together
  with its CEFR level.
- Callback data uses the `onb:` prefix as one handler group; anything an onboarded user can
  tap uses a different prefix.
- Generating demo cards never publishes — only the explicit `setActive` review does;
  unreviewed rows are invisible to reads. The demo tap never calls an AI adapter; a cache
  miss falls back to the production translate flow.
