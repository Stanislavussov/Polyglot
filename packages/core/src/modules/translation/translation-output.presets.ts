/**
 * Translation Output Presets — re-exports from shared/.
 *
 * Presets live in shared/ so leaf modules (topics, etc.) can use them
 * without creating forbidden cross-module imports. This file re-exports
 * them for backward compatibility — existing callers importing from
 * translation/ continue to work.
 */
export {
  FULL_OUTPUT,
  MINIMAL_OUTPUT,
  NOTIFICATION_OUTPUT,
  RELIABLE_OUTPUT,
  SENTENCE_OUTPUT,
} from "../../shared/translation-output.presets.js";
