import { describe, expect, it } from "vitest";
import { getScriptKey, isValidScript } from "@/lib/script-pool";
import { ensureAnchors } from "@/lib/anchor";
import type { Script } from "@/lib/types";

const script: Script = {
  topic: "Morning Routine",
  category: "Daily Life",
  turns: [
    { speaker: "coach", text: "What did you do this morning?" },
    {
      speaker: "user",
      text: "I went for a run.",
      anchor: { intent: "describe a past routine", keyPoints: ["mention an activity"], sampleAnswer: "I went for a run." },
    },
    { speaker: "coach", text: "Nice. What did you eat?" },
    { speaker: "user", text: "I had toast." },
    { speaker: "coach", text: "How did you commute?" },
    { speaker: "user", text: "I took the subway." },
  ],
};

describe("script-pool anchor passthrough", () => {
  it("treats a script with anchors as valid", () => {
    expect(isValidScript(script)).toBe(true);
  });

  it("preserves anchors across a JSON cache round-trip", () => {
    const roundTripped = JSON.parse(JSON.stringify(script)) as Script;
    expect(isValidScript(roundTripped)).toBe(true);
    expect(roundTripped.turns[1].anchor?.intent).toBe("describe a past routine");
  });

  it("keeps the cache key stable whether or not anchors are present", () => {
    const withAnchors = ensureAnchors(script);
    expect(getScriptKey(withAnchors)).toBe(getScriptKey(script));
  });
});
