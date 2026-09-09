/**
 * dependency-cruiser configuration for Polyglot monorepo.
 *
 * Enforces the canonical dependency direction across packages and
 * internal core modules. See @docs/tasks/22-dependency-cruiser.md and
 * @docs/fable/T28-dep-cruiser-allowlist.md.
 *
 * Package-level rules are enumerated denylists. Core-internal module rules
 * use an allowlist model (T28/A14): every core module is restricted to a
 * declared set of allowed sibling modules, and a default rule constrains any
 * module without an explicit allow rule to importing only itself — so a new
 * module is restricted by default rather than silently unconstrained.
 *
 * The bot scenes→adapters boundary (no-bot-scenes-importing-adapters) is an
 * error: scene/helper code reaches services through ctx.services; only the
 * composition root (container.ts) and bootstrap/entry files import adapters.
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
      comment:
        "Bot scenes/helpers must reach services via ctx.services, never directly from adapters. " +
        "Raised to error in T28 after the T22 DI refactor removed the direct scene→adapter imports; " +
        "only the composition root (container.ts) and bootstrap/entry files may import adapters.",
      severity: "error",
      from: { path: "^apps/bot/src/scenes/" },
      to: {
        path: [
          "^packages/adapters/db/",
          "^packages/adapters/ai/",
          "^packages/adapters/notifications/",
        ],
      },
    },

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
    // Core-internal module rules (allowlist model — T28/A14)
    //
    // Instead of each module enumerating its forbidden neighbours
    // (a denylist, which silently lets any *unlisted* module import
    // anything), every core module is constrained to a declared set of
    // allowed sibling modules. The mechanism is a `forbidden` rule whose
    // `to.pathNot` names the allowed set: any import from the module into
    // another core module that is NOT in that set is flagged.
    //
    // The default rule below applies to every module that has no explicit
    // allow rule and constrains it to importing only itself — so a brand
    // new module is RESTRICTED by default until its allowed siblings are
    // declared here. Modules that legitimately import siblings
    // (validation, translation, context-enrichment, notifications) are
    // carved out of the default via `from.pathNot` and given their own
    // rule. Type-only imports are not analysed by dependency-cruiser
    // (tsPreCompilationDeps defaults to false), so these rules constrain
    // runtime (value) dependencies, which is the boundary that matters.
    // ───────────────────────────────────────────────

    {
      name: "core-module-no-undeclared-sibling-import",
      comment:
        "Default core-module boundary: a module may import only itself among core modules. " +
        "Any new module is restricted by default; declare an explicit allow rule below to widen it.",
      severity: "error",
      from: {
        path: "^packages/core/src/modules/([^/]+)/",
        // Modules with an explicit allow rule below are exempt from the default.
        pathNot:
          "^packages/core/src/modules/(validation|translation|context-enrichment|notifications|tts)/",
      },
      to: {
        path: "^packages/core/src/modules/",
        pathNot: "^packages/core/src/modules/$1/",
      },
    },
    {
      name: "core-validation-allowlist",
      comment: "validation may import only i18n among core modules",
      severity: "error",
      from: { path: "^packages/core/src/modules/validation/" },
      to: {
        path: "^packages/core/src/modules/",
        pathNot: "^packages/core/src/modules/(validation|i18n)/",
      },
    },
    {
      name: "core-translation-allowlist",
      comment: "translation may import only i18n, input-analysis, and validation among core modules",
      severity: "error",
      from: { path: "^packages/core/src/modules/translation/" },
      to: {
        path: "^packages/core/src/modules/",
        pathNot: "^packages/core/src/modules/(translation|i18n|input-analysis|validation)/",
      },
    },
    {
      name: "core-context-enrichment-allowlist",
      comment: "context-enrichment may import only translation among core modules",
      severity: "error",
      from: { path: "^packages/core/src/modules/context-enrichment/" },
      to: {
        path: "^packages/core/src/modules/",
        pathNot: "^packages/core/src/modules/(context-enrichment|translation)/",
      },
    },
    {
      name: "core-notifications-allowlist",
      comment: "notifications may import only i18n among core modules",
      severity: "error",
      from: { path: "^packages/core/src/modules/notifications/" },
      to: {
        path: "^packages/core/src/modules/",
        pathNot: "^packages/core/src/modules/(notifications|i18n)/",
      },
    },
    {
      name: "core-tts-allowlist",
      comment:
        "tts may import only vocabulary among core modules — the pronunciation buttons " +
        "must follow the same language ordering as the card blocks above them, and that " +
        "ordering has exactly one definition (vocabulary/translation-order).",
      severity: "error",
      from: { path: "^packages/core/src/modules/tts/" },
      to: {
        path: "^packages/core/src/modules/",
        pathNot: "^packages/core/src/modules/(tts|vocabulary)/",
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
