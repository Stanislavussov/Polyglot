/**
 * dependency-cruiser configuration for Polyglot monorepo.
 *
 * Enforces the canonical dependency direction across packages and
 * internal core modules. See @docs/tasks/22-dependency-cruiser.md.
 *
 * Audit summary (at time of authoring):
 *   0 package-level violations found.
 *   0 core-internal module violations found (after fixes in this task).
 *
 * Rule coverage:
 *   - no-core-importing-polyglot: 0 violations (architecture clean)
 *   - no-adapter-db-importing-infra: 0 violations (architecture clean)
 *   - no-adapter-db-importing-ai-or-notifications: 0 violations (architecture clean)
 *   - no-infra-importing-adapters-ai-or-notifications: 0 violations (architecture clean)
 *   - no-adapter-ai-importing-db-or-notifications: 0 violations (architecture clean)
 *   - no-adapter-notifications-importing-ai-or-db: 0 violations (architecture clean)
 *   - no-circular: 0 violations
 *   - no-i18n-importing-other-modules: 0 violations (leaf module clean)
 *   - no-language-detect-importing-other-modules: 0 violations (leaf module clean)
 *   - no-idiom-analysis-importing-other-modules: 0 violations (fixed: extracted getLanguageName via DI)
 *   - no-topics-importing-other-modules: 0 violations (fixed: moved shared types/presets to shared/)
 *   - no-validation-importing-translation-or-higher: 0 violations (architecture clean)
 *   - no-translation-importing-context-or-higher: 0 violations (architecture clean)
 *   - no-context-enrichment-importing-unsupported: 0 violations (architecture clean)
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ───────────────────────────────────────────────
    // Package-level rules
    // ───────────────────────────────────────────────

    {
      name: "no-core-importing-polyglot",
      comment: "@polyglot/core must not import any @polyglot/* package",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: {
        path: [
          "^packages/adapters/",
          "^packages/infra/",
          "^apps/",
        ],
      },
    },
    {
      name: "no-adapter-db-importing-infra",
      comment: "@polyglot/adapter-db must not import @polyglot/infra",
      severity: "error",
      from: { path: "^packages/adapters/db/src" },
      to: { path: "^packages/infra/" },
    },
    {
      name: "no-adapter-ai-importing-infra",
      comment: "@polyglot/adapter-ai must not import @polyglot/infra",
      severity: "error",
      from: { path: "^packages/adapters/ai/src" },
      to: { path: "^packages/infra/" },
    },
    {
      name: "no-adapter-notifications-importing-infra",
      comment: "@polyglot/adapter-notifications must not import @polyglot/infra",
      severity: "error",
      from: { path: "^packages/adapters/notifications/src" },
      to: { path: "^packages/infra/" },
    },
    {
      name: "no-adapter-db-importing-ai-or-notifications",
      comment: "@polyglot/adapter-db must not import @polyglot/adapter-ai or @polyglot/adapter-notifications",
      severity: "error",
      from: { path: "^packages/adapters/db/src" },
      to: {
        path: [
          "^packages/adapters/ai/",
          "^packages/adapters/notifications/",
        ],
      },
    },
    {
      name: "no-infra-importing-adapters-ai-or-notifications",
      comment: "@polyglot/infra must not import @polyglot/adapter-ai or @polyglot/adapter-notifications",
      severity: "error",
      from: { path: "^packages/infra/src" },
      to: {
        path: [
          "^packages/adapters/ai/",
          "^packages/adapters/notifications/",
        ],
      },
    },
    {
      name: "no-adapter-ai-importing-db-or-notifications",
      comment: "@polyglot/adapter-ai must not import @polyglot/adapter-db or @polyglot/adapter-notifications",
      severity: "error",
      from: { path: "^packages/adapters/ai/src" },
      to: {
        path: [
          "^packages/adapters/db/",
          "^packages/adapters/notifications/",
        ],
      },
    },
    {
      name: "no-adapter-notifications-importing-ai-or-db",
      comment: "@polyglot/adapter-notifications must not import @polyglot/adapter-ai or @polyglot/adapter-db",
      severity: "error",
      from: { path: "^packages/adapters/notifications/src" },
      to: {
        path: [
          "^packages/adapters/ai/",
          "^packages/adapters/db/",
        ],
      },
    },
    {
      name: "no-bot-scenes-importing-adapters",
      comment: "Bot scenes/helpers should import services via ctx.services, not directly from adapters (task-42 incremental migration)",
      severity: "info",
      from: { path: "^apps/bot/src/scenes/" },
      to: {
        path: [
          "^packages/adapters/db/",
          "^packages/adapters/ai/",
          "^packages/adapters/notifications/",
        ],
      },
    },
    // Remove this rule after task-42 migration is complete
    // {
    //   name: "no-bot-scenes-importing-adapters",
    //   comment: "Bot scenes/helpers should import services via ctx.services, not directly from adapters (task-42 incremental migration)",
    //   severity: "info",
    //   from: { path: "^apps/bot/src/scenes/" },
    //   to: {
    //     path: [
    //       "^packages/adapters/db/",
    //       "^packages/adapters/ai/",
    //       "^packages/adapters/notifications/",
    //     ],
    //   },
    // },

    // ───────────────────────────────────────────────
    // Circular dependency rule
    // ───────────────────────────────────────────────

    {
      name: "no-circular",
      comment: "No circular dependencies anywhere in the codebase",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // ───────────────────────────────────────────────
    // Core-internal module rules
    // ───────────────────────────────────────────────

    {
      name: "no-i18n-importing-other-modules",
      comment: "i18n is a leaf module — must not import from any sibling module",
      severity: "error",
      from: { path: "^packages/core/src/modules/i18n/" },
      to: {
        path: [
          "^packages/core/src/modules/translation/",
          "^packages/core/src/modules/validation/",
          "^packages/core/src/modules/topics/",
          "^packages/core/src/modules/context-enrichment/",
          "^packages/core/src/modules/idiom-analysis/",
          "^packages/core/src/modules/language-detect/",
          "^packages/core/src/modules/input-analysis/",
        ],
      },
    },
    {
      name: "no-language-detect-importing-other-modules",
      comment: "language-detect is a leaf module — must not import from any sibling module",
      severity: "error",
      from: { path: "^packages/core/src/modules/language-detect/" },
      to: {
        path: [
          "^packages/core/src/modules/translation/",
          "^packages/core/src/modules/validation/",
          "^packages/core/src/modules/topics/",
          "^packages/core/src/modules/context-enrichment/",
          "^packages/core/src/modules/idiom-analysis/",
          "^packages/core/src/modules/i18n/",
          "^packages/core/src/modules/input-analysis/",
        ],
      },
    },
    {
      name: "no-input-analysis-importing-other-modules",
      comment: "input-analysis is a leaf module — must not import from any sibling module",
      severity: "error",
      from: { path: "^packages/core/src/modules/input-analysis/" },
      to: {
        path: [
          "^packages/core/src/modules/translation/",
          "^packages/core/src/modules/validation/",
          "^packages/core/src/modules/topics/",
          "^packages/core/src/modules/context-enrichment/",
          "^packages/core/src/modules/idiom-analysis/",
          "^packages/core/src/modules/i18n/",
          "^packages/core/src/modules/language-detect/",
        ],
      },
    },
    {
      name: "no-idiom-analysis-importing-other-modules",
      comment: "idiom-analysis is a leaf module — must not import from any sibling module",
      severity: "error",
      from: { path: "^packages/core/src/modules/idiom-analysis/" },
      to: {
        path: [
          "^packages/core/src/modules/translation/",
          "^packages/core/src/modules/validation/",
          "^packages/core/src/modules/topics/",
          "^packages/core/src/modules/context-enrichment/",
          "^packages/core/src/modules/i18n/",
          "^packages/core/src/modules/language-detect/",
          "^packages/core/src/modules/input-analysis/",
        ],
      },
    },
    {
      name: "no-topics-importing-other-modules",
      comment: "topics is a leaf module — must not import from any sibling module",
      severity: "error",
      from: { path: "^packages/core/src/modules/topics/" },
      to: {
        path: [
          "^packages/core/src/modules/translation/",
          "^packages/core/src/modules/validation/",
          "^packages/core/src/modules/context-enrichment/",
          "^packages/core/src/modules/idiom-analysis/",
          "^packages/core/src/modules/i18n/",
          "^packages/core/src/modules/language-detect/",
          "^packages/core/src/modules/input-analysis/",
        ],
      },
    },
    {
      name: "no-validation-importing-translation-or-higher",
      comment: "validation may import i18n but must not import translation, topics, context-enrichment, idiom-analysis, language-detect, or input-analysis",
      severity: "error",
      from: { path: "^packages/core/src/modules/validation/" },
      to: {
        path: [
          "^packages/core/src/modules/translation/",
          "^packages/core/src/modules/topics/",
          "^packages/core/src/modules/context-enrichment/",
          "^packages/core/src/modules/idiom-analysis/",
          "^packages/core/src/modules/language-detect/",
          "^packages/core/src/modules/input-analysis/",
        ],
      },
    },
    {
      name: "no-translation-importing-context-or-higher",
      comment: "translation may import validation, i18n, and input-analysis but must not import context-enrichment, topics, idiom-analysis, or language-detect",
      severity: "error",
      from: { path: "^packages/core/src/modules/translation/" },
      to: {
        path: [
          "^packages/core/src/modules/context-enrichment/",
          "^packages/core/src/modules/topics/",
          "^packages/core/src/modules/idiom-analysis/",
          "^packages/core/src/modules/language-detect/",
        ],
      },
    },
    {
      name: "no-context-enrichment-importing-unsupported",
      comment: "context-enrichment may import translation but must not import validation, topics, idiom-analysis, i18n, language-detect, or input-analysis",
      severity: "error",
      from: { path: "^packages/core/src/modules/context-enrichment/" },
      to: {
        path: [
          "^packages/core/src/modules/validation/",
          "^packages/core/src/modules/topics/",
          "^packages/core/src/modules/idiom-analysis/",
          "^packages/core/src/modules/i18n/",
          "^packages/core/src/modules/language-detect/",
          "^packages/core/src/modules/input-analysis/",
        ],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules", "dist", "\\.test\\.ts$", "\\.spec\\.ts$"],
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    moduleSystems: ["es6", "cjs"],
  },
};
