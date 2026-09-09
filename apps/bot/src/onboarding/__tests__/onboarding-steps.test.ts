/**
 * Task 72 slice 1 — onboarding instrumentation primitives.
 *
 * Spec under test:
 * - `recordOnboardingStep(step, outcome)` increments `bot_onboarding_step_total`
 *   on the {step, outcome} label pair it was given, and only that pair.
 * - The metric's label space stays bounded: every value the enums allow is a
 *   legal label, and nothing outside them is reachable through the helper.
 */
import { register } from "prom-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
});

const { ONBOARDING_OUTCOMES, ONBOARDING_STEPS, recordOnboardingStep } = await import("../onboarding-steps.js");

const METRIC_NAME = "bot_onboarding_step_total";

type SampleLabels = Partial<Record<string, string | number>>;

/** Reads the counter's current samples straight off the shared prom-client registry. */
async function samples(): Promise<Array<{ labels: SampleLabels; value: number }>> {
  const metric = register.getSingleMetric(METRIC_NAME);
  if (!metric) throw new Error(`${METRIC_NAME} is not registered`);
  const collected = await metric.get();
  return collected.values.map((sample) => ({ labels: sample.labels, value: sample.value }));
}

beforeEach(() => {
  register.getSingleMetric(METRIC_NAME)?.reset();
});

describe("recordOnboardingStep", () => {
  it("increments bot_onboarding_step_total for the recorded step and outcome", async () => {
    recordOnboardingStep(ONBOARDING_STEPS.demo, "hook_tapped");

    expect(await samples()).toEqual([{ labels: { step: "3", outcome: "hook_tapped" }, value: 1 }]);
  });

  it("accumulates repeated events on the same label pair", async () => {
    recordOnboardingStep(ONBOARDING_STEPS.native, "entered");
    recordOnboardingStep(ONBOARDING_STEPS.native, "entered");
    recordOnboardingStep(ONBOARDING_STEPS.native, "completed");

    expect(await samples()).toEqual(
      expect.arrayContaining([
        { labels: { step: "1", outcome: "entered" }, value: 2 },
        { labels: { step: "1", outcome: "completed" }, value: 1 },
      ]),
    );
  });

  it("keeps steps on separate series so the funnel can be read per screen", async () => {
    recordOnboardingStep(ONBOARDING_STEPS.languages, "entered");
    recordOnboardingStep(ONBOARDING_STEPS.demo, "entered");
    recordOnboardingStep(ONBOARDING_STEPS.complete, "entered");

    const bySteps = (await samples()).map((sample) => sample.labels.step);
    expect(bySteps).toEqual(["2", "3", "4"]);
  });

  it("emits a bounded label space — one series per (step, outcome) and nothing else", async () => {
    const steps = Object.values(ONBOARDING_STEPS);
    for (const step of steps) {
      for (const outcome of ONBOARDING_OUTCOMES) {
        recordOnboardingStep(step, outcome);
      }
    }

    const collected = await samples();
    expect(collected).toHaveLength(steps.length * ONBOARDING_OUTCOMES.length);
    for (const sample of collected) {
      expect(Object.keys(sample.labels).sort()).toEqual(["outcome", "step"]);
      expect(ONBOARDING_OUTCOMES).toContain(sample.labels.outcome);
      expect(steps.map(String)).toContain(sample.labels.step);
      expect(sample.value).toBe(1);
    }
  });
});

describe("onboarding vocabulary", () => {
  /**
   * The step numbers are a storage contract (`users.onboarding_step`) and the
   * outcomes are the metric's label domain — renumbering or dropping one
   * silently reinterprets historic rows and existing series, so pin them.
   */
  it("pins the persisted step numbers and the outcome domain", () => {
    expect(Object.entries(ONBOARDING_STEPS)).toEqual([
      ["native", 1],
      ["languages", 2],
      ["demo", 3],
      ["complete", 4],
    ]);
    expect([...ONBOARDING_OUTCOMES]).toEqual(["entered", "hook_tapped", "typed_word", "failed", "completed"]);
  });
});
