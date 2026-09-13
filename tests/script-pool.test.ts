import { describe, expect, it } from "vitest";
import { getScriptKey, isValidScript, pickScriptFromRecords, type AdminScriptRecord } from "@/lib/script-pool";
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

describe("pickScriptFromRecords", () => {
  const make = (topic: string, audioReady?: boolean): AdminScriptRecord => ({
    key: topic,
    source: "seed",
    audioReady,
    script: { ...script, topic },
  });

  it("prefers scripts whose coach audio is already cached", () => {
    const records = [make("no-audio", false), make("ready-1", true), make("ready-2", true)];
    for (let i = 0; i < 20; i += 1) {
      expect(pickScriptFromRecords(records, "Daily Life").topic).toMatch(/^ready-/);
    }
  });

  it("falls back to any script in the category when none has audio", () => {
    const records = [make("a", false), make("b")];
    expect(["a", "b"]).toContain(pickScriptFromRecords(records, "Daily Life").topic);
  });

  it("falls back to builtin scripts when the category is empty", () => {
    expect(pickScriptFromRecords([], "Daily Life").category).toBe("Daily Life");
  });
});
