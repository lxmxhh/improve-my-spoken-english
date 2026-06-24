import { describe, expect, it } from "vitest";
import { normalizeScript } from "@/app/api/generate-script/route";
import { ensureAnchors } from "@/lib/anchor";

const base = {
  topic: "Morning Routine",
  category: "Daily Life",
};

// normalizeScript requires >= 6 alternating turns starting with coach.
function pad(userTurn: Record<string, unknown>) {
  return [
    { speaker: "coach", text: "What did you do this morning?" },
    userTurn,
    { speaker: "coach", text: "Nice. What did you eat?" },
    { speaker: "user", text: "I had toast and coffee." },
    { speaker: "coach", text: "How did you get to work?" },
    { speaker: "user", text: "I took the subway." },
  ];
}

describe("normalizeScript anchor parsing", () => {
  it("parses a full anchor on a user turn", () => {
    const raw = {
      ...base,
      turns: pad({
        speaker: "user",
        text: "I went for a run.",
        intent: "describe a past routine",
        keyPoints: ["mention an activity", "mention a time"],
        sampleAnswer: "I went for a run around seven.",
      }),
    };
    const script = normalizeScript(raw, "Daily Life");
    expect(script.turns[1].anchor?.intent).toBe("describe a past routine");
    expect(script.turns[1].anchor?.keyPoints).toHaveLength(2);
    expect(script.turns[1].anchor?.sampleAnswer).toBe("I went for a run around seven.");
  });

  it("leaves user turn without anchor when none provided (filled later by ensureAnchors)", () => {
    const raw = { ...base, turns: pad({ speaker: "user", text: "I went for a run." }) };
    const script = normalizeScript(raw, "Daily Life");
    expect(script.turns[1].anchor).toBeUndefined();

    const withAnchors = ensureAnchors(script);
    expect(withAnchors.turns[1].anchor?.sampleAnswer).toBe("I went for a run.");
    expect(withAnchors.turns[3].anchor?.sampleAnswer).toBe("I had toast and coffee.");
  });

  it("repairs a half-formed anchor (intent only, no keyPoints)", () => {
    const raw = {
      ...base,
      turns: pad({ speaker: "user", text: "I went for a run.", intent: "describe a past routine" }),
    };
    const script = normalizeScript(raw, "Daily Life");
    expect(script.turns[1].anchor?.intent).toBe("describe a past routine");
    expect(script.turns[1].anchor?.keyPoints.length).toBeGreaterThanOrEqual(1);
    expect(script.turns[1].anchor?.sampleAnswer).toBe("I went for a run.");
  });

  it("still accepts the legacy compact lines shape", () => {
    const raw = {
      ...base,
      lines: [
        ["coach", "What did you do this morning?"],
        ["user", "I went for a run."],
        ["coach", "Nice. What did you eat?"],
        ["user", "I had toast and coffee."],
        ["coach", "How did you get to work?"],
        ["user", "I took the subway."],
      ],
    };
    const script = ensureAnchors(normalizeScript(raw, "Daily Life"));
    expect(script.turns).toHaveLength(6);
    expect(script.turns[1].anchor?.sampleAnswer).toBe("I went for a run.");
  });
});
