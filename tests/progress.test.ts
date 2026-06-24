import { describe, expect, it } from "vitest";
import {
  buildProgressSeries,
  passRatePercent,
  progressSummary,
  sortByTimeAsc,
} from "@/lib/progress";
import type { Session } from "@/lib/types";

function session(overrides: Partial<Session>): Session {
  return {
    id: Math.random().toString(36).slice(2),
    date: "2026-06-10",
    topic: "t",
    category: "Daily Life",
    durationSec: 120,
    totalLines: 4,
    passedLines: 2,
    failedLines: 2,
    summary: "",
    completedAt: "2026-06-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("passRatePercent", () => {
  it("computes a rounded percentage", () => {
    expect(passRatePercent(session({ passedLines: 3, totalLines: 4 }))).toBe(75);
  });
  it("is 0 when there are no lines", () => {
    expect(passRatePercent(session({ passedLines: 0, totalLines: 0 }))).toBe(0);
  });
});

describe("sortByTimeAsc", () => {
  it("orders oldest to newest", () => {
    const a = session({ completedAt: "2026-06-12T10:00:00.000Z", date: "2026-06-12" });
    const b = session({ completedAt: "2026-06-10T10:00:00.000Z", date: "2026-06-10" });
    const ordered = sortByTimeAsc([a, b]);
    expect(ordered[0].date).toBe("2026-06-10");
    expect(ordered[1].date).toBe("2026-06-12");
  });
});

describe("buildProgressSeries", () => {
  it("returns a chronological pass-rate series", () => {
    const series = buildProgressSeries([
      session({ completedAt: "2026-06-12T10:00:00.000Z", date: "2026-06-12", passedLines: 4, totalLines: 4 }),
      session({ completedAt: "2026-06-10T10:00:00.000Z", date: "2026-06-10", passedLines: 1, totalLines: 4 }),
    ]);
    expect(series.passRate.map((p) => p.value)).toEqual([25, 100]);
  });

  it("includes only sessions that recorded a scaffold level", () => {
    const series = buildProgressSeries([
      session({ date: "2026-06-10", avgScaffoldLevel: 1.5 }),
      session({ date: "2026-06-11" }), // assessment-only, no scaffold
      session({ date: "2026-06-12", avgScaffoldLevel: 0.5 }),
    ]);
    expect(series.scaffold.map((p) => p.value)).toEqual([1.5, 0.5]);
  });
});

describe("progressSummary", () => {
  it("aggregates count, minutes, and average pass rate", () => {
    const summary = progressSummary([
      session({ durationSec: 120, passedLines: 4, totalLines: 4 }),
      session({ durationSec: 180, passedLines: 2, totalLines: 4 }),
    ]);
    expect(summary.sessionCount).toBe(2);
    expect(summary.totalMinutes).toBe(5);
    expect(summary.avgPassRate).toBe(75);
  });

  it("is all-zero for no sessions", () => {
    expect(progressSummary([])).toEqual({ sessionCount: 0, totalMinutes: 0, avgPassRate: 0 });
  });
});
