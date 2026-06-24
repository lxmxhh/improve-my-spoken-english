import { describe, expect, it } from "vitest";
import { improvementMs, speedRoundBudgetsMs, SPEED_ROUND_REPS } from "@/lib/speed-round";

describe("speedRoundBudgetsMs", () => {
  it("returns one budget per rep", () => {
    expect(speedRoundBudgetsMs("I went for a run this morning.")).toHaveLength(SPEED_ROUND_REPS);
  });

  it("shrinks monotonically", () => {
    const budgets = speedRoundBudgetsMs("I often have oatmeal with banana and a little honey.");
    expect(budgets[0]).toBeGreaterThanOrEqual(budgets[1]);
    expect(budgets[1]).toBeGreaterThanOrEqual(budgets[2]);
  });

  it("stays within bounds even for very long or empty text", () => {
    const long = speedRoundBudgetsMs("word ".repeat(80));
    const empty = speedRoundBudgetsMs("");
    for (const b of [...long, ...empty]) {
      expect(b).toBeGreaterThanOrEqual(4_000);
      expect(b).toBeLessThanOrEqual(18_000);
    }
  });
});

describe("improvementMs", () => {
  it("is positive when the learner got faster", () => {
    expect(improvementMs([14_000, 11_000, 9_000])).toBe(5_000);
  });

  it("is negative when slower", () => {
    expect(improvementMs([9_000, 12_000])).toBe(-3_000);
  });

  it("is zero with fewer than two attempts", () => {
    expect(improvementMs([10_000])).toBe(0);
    expect(improvementMs([])).toBe(0);
  });
});
