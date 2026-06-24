import { describe, expect, it } from "vitest";
import { freeFallbackFeedback } from "@/app/api/pronunciation-coach/route";

describe("freeFallbackFeedback", () => {
  it("coaches the learner's own sentence, not a model answer", () => {
    const fb = freeFallbackFeedback("I check my phone and drink water");
    expect(fb.tips.length).toBeGreaterThanOrEqual(1);
    // practiceText must echo the learner's own words, never a fixed model answer
    expect(fb.tips[0].practiceText).toContain("phone");
    expect(fb.summary.length).toBeGreaterThan(0);
    expect(fb.retryPrompt.length).toBeGreaterThan(0);
  });

  it("handles empty/no-speech gracefully", () => {
    const fb = freeFallbackFeedback("   ");
    expect(fb.tips.length).toBeGreaterThanOrEqual(1);
    expect(fb.summary).toMatch(/again|catch/i);
  });
});
