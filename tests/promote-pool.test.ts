import { describe, expect, it } from "vitest";
import { promotePool } from "../scripts/promote-pool.mjs";

function script(topic: string, category = "Daily Life", suffix = "", extra: Record<string, unknown> = {}) {
  return {
    topic,
    category,
    turns: [
      { speaker: "coach", text: `Q1 ${topic}${suffix}` },
      { speaker: "user", text: `A1 ${topic}${suffix}`, ...extra },
      { speaker: "coach", text: "Q2" },
      { speaker: "user", text: "A2" },
      { speaker: "coach", text: "Q3" },
      { speaker: "user", text: "A3" },
    ],
  };
}

describe("promotePool", () => {
  it("adds runtime-only scripts, replaces same-key seed scripts with the enriched copy, and caps topic variants", () => {
    const seed = { "Daily Life": [script("Morning"), script("Lunch", "Daily Life", " v1")] };
    const pool = {
      "Daily Life": [
        script("Morning", "Daily Life", "", { hint: "enriched" }),
        script("Dinner"),
        script("lunch", "Daily Life", " v2"),
        script("Lunch", "Daily Life", " v3"),
      ],
      "Work & Career": [script("Interview", "Work & Career")],
    };

    const { seed: next, summary } = promotePool(seed, pool) as {
      seed: Record<string, { topic: string; turns: { hint?: string }[] }[]>;
      summary: unknown;
    };

    expect(next["Daily Life"].map((s) => s.topic)).toEqual(["Morning", "Lunch", "Dinner", "lunch"]);
    expect(next["Daily Life"][0].turns[1].hint).toBe("enriched");
    expect(next["Work & Career"].map((s) => s.topic)).toEqual(["Interview"]);
    expect(summary).toEqual({ updated: 1, added: 3, skipped: 1 });
  });

  it("ignores invalid entries", () => {
    const { seed, summary } = promotePool({}, { "Daily Life": [{ topic: "Broken", category: "Daily Life", turns: [] }] });
    expect(seed).toEqual({});
    expect(summary).toEqual({ updated: 0, added: 0, skipped: 1 });
  });
});
