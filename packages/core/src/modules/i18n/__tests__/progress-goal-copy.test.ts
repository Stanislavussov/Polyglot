import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");
const locales = readdirSync(localesDir).filter((file) => file.endsWith(".json"));

const BANDS = ["Resting", "Warming", "Steady", "Strong"];
const GOALS = ["Day", "Week", "Month"];
const GOAL_KEYS = GOALS.flatMap((goal) => BANDS.map((band) => `progressGoal${goal}${band}`));
const LADDER_KEYS = [
  ...GOAL_KEYS,
  "progressGoalMonths",
  "progressGoalMonthsFirst",
  "progressGoalMonth",
  "progressGoalMilestone",
  "progressGoalMilestonesAll",
  "progressGoalDayDone",
  "progressGoalDayTodo",
  "progressRewardCreated",
  "progressRewardExtended",
];

/** The ladder is never strict: nothing burns, breaks or is lost. */
const PUNITIVE =
  /\b(lost|lose|fail|failed|missed|streak|broke|behind|only)\b|потерял|провал|пропустил|сгорел|всего лишь/iu;

describe("goal-ladder copy", () => {
  for (const file of locales) {
    const dict = JSON.parse(readFileSync(join(localesDir, file), "utf8")) as Record<string, string>;

    it(`${file}: has every ladder key, one distinct line per band × goal`, () => {
      for (const key of LADDER_KEYS) expect(dict[key], `${file} → ${key}`).toBeTruthy();
      const goalLines = GOAL_KEYS.map((key) => dict[key]);
      expect(new Set(goalLines).size).toBe(GOAL_KEYS.length);
    });

    it(`${file}: never scolds`, () => {
      for (const key of LADDER_KEYS) expect(dict[key], `${file} → ${key}`).not.toMatch(PUNITIVE);
    });
  }
});
