import { describe, expect, it } from "vitest";
import { interpretAnswer, quickVerdict, wordOverlap } from "@/lib/answer-check";
import type { CoachPromptAnchor } from "@/lib/types";

const anchor: CoachPromptAnchor = {
  intent: "describe a past routine",
  keyPoints: ["mention an activity", "mention a time"],
  sampleAnswer: "I went for a run around seven.",
};

describe("quickVerdict", () => {
  it("fails empty / no-speech input", () => {
    expect(quickVerdict("anything", "")).toBe(false);
    expect(quickVerdict("anything", "   ", anchor)).toBe(false);
  });

  it("passes an exact or near-exact match of the model answer", () => {
    expect(quickVerdict("", "I went for a run around seven.", anchor)).toBe(true);
  });

  it("defers a different-but-plausible free answer to the model (null)", () => {
    expect(quickVerdict("", "I slept in and skipped breakfast.", anchor)).toBeNull();
  });

  it("without anchor, defers a paraphrase to the model", () => {
    expect(quickVerdict("I went for a run.", "I did some jogging.")).toBeNull();
  });
});

describe("interpretAnswer", () => {
  it("reads an explicit yes/no", () => {
    expect(interpretAnswer("yes", { actual: "x", reference: "y", hasAnchor: true })).toBe(true);
    expect(interpretAnswer("No.", { actual: "x", reference: "y", hasAnchor: true })).toBe(false);
  });

  it("fails open on empty model reply in direction (anchor) mode", () => {
    expect(interpretAnswer("", { actual: "totally off topic", reference: "ref", hasAnchor: true })).toBe(true);
  });

  it("falls back to word overlap on empty reply without anchor", () => {
    expect(
      interpretAnswer("", { actual: "I went for a run", reference: "I went for a run", hasAnchor: false })
    ).toBe(true);
    expect(
      interpretAnswer("", { actual: "pizza tastes good", reference: "I went for a run", hasAnchor: false })
    ).toBe(false);
  });
});

describe("wordOverlap", () => {
  it("is 1 for identical and 0 for disjoint", () => {
    expect(wordOverlap("a b c", "a b c")).toBe(1);
    expect(wordOverlap("a b", "x y")).toBe(0);
  });
});
