import { describe, expect, it } from "vitest";
import { buildFallbackAnchor, ensureAnchors, extractContentWords } from "@/lib/anchor";
import type { Script } from "@/lib/types";

describe("extractContentWords", () => {
  it("keeps content words and drops stopwords", () => {
    const words = extractContentWords("I usually wake up at seven in the morning.");
    expect(words).toContain("wake");
    expect(words).toContain("morning");
    expect(words).not.toContain("the");
    expect(words.length).toBeLessThanOrEqual(3);
  });

  it("dedupes repeated words", () => {
    const words = extractContentWords("coffee coffee coffee please", 3);
    expect(words.filter((w) => w === "coffee")).toHaveLength(1);
  });
});

describe("buildFallbackAnchor", () => {
  it("produces a non-empty sampleAnswer and at least one keyPoint", () => {
    const anchor = buildFallbackAnchor("I went for a run.", "What did you do this morning?");
    expect(anchor.sampleAnswer).toBe("I went for a run.");
    expect(anchor.keyPoints.length).toBeGreaterThanOrEqual(1);
    expect(anchor.intent).toMatch(/question/);
  });

  it("degrades gracefully for a very short line with no content words", () => {
    const anchor = buildFallbackAnchor("Yes I do.", "Do you?");
    expect(anchor.sampleAnswer).toBe("Yes I do.");
    expect(anchor.keyPoints.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ensureAnchors", () => {
  it("fills missing anchors on user turns and leaves coach turns alone", () => {
    const script: Script = {
      topic: "t",
      category: "Daily Life",
      turns: [
        { speaker: "coach", text: "What did you do this morning?" },
        { speaker: "user", text: "I went for a run." },
      ],
    };
    const result = ensureAnchors(script);
    expect(result.turns[0].anchor).toBeUndefined();
    expect(result.turns[1].anchor?.sampleAnswer).toBe("I went for a run.");
  });

  it("keeps an existing valid anchor untouched", () => {
    const script: Script = {
      topic: "t",
      category: "Daily Life",
      turns: [
        { speaker: "coach", text: "Q?" },
        {
          speaker: "user",
          text: "A.",
          anchor: { intent: "custom", keyPoints: ["kp"], sampleAnswer: "A." },
        },
      ],
    };
    const result = ensureAnchors(script);
    expect(result.turns[1].anchor?.intent).toBe("custom");
  });
});
