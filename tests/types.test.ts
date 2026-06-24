import { describe, expect, it } from "vitest";
import type { CoachPromptAnchor, Script, Session } from "@/lib/types";

describe("type compatibility", () => {
  it("accepts a legacy script with no anchor on turns", () => {
    const legacy: Script = {
      topic: "Morning Routine",
      category: "Daily Life",
      turns: [
        { speaker: "coach", text: "What did you do this morning?" },
        { speaker: "user", text: "I went for a run." },
      ],
    };
    expect(legacy.turns[1].anchor).toBeUndefined();
  });

  it("accepts a user turn carrying a CoachPromptAnchor", () => {
    const anchor: CoachPromptAnchor = {
      intent: "describe a past routine",
      keyPoints: ["mention an activity", "mention a time"],
      sampleAnswer: "I went for a run around seven.",
    };
    const script: Script = {
      topic: "Morning Routine",
      category: "Daily Life",
      turns: [
        { speaker: "coach", text: "What did you do this morning?" },
        { speaker: "user", text: "I went for a run.", anchor },
      ],
    };
    expect(script.turns[1].anchor?.keyPoints).toHaveLength(2);
  });

  it("accepts a legacy session with no scaffold fields", () => {
    const session: Session = {
      id: "x",
      date: "2026-06-16",
      topic: "t",
      category: "c",
      durationSec: 10,
      totalLines: 2,
      passedLines: 2,
      failedLines: 0,
      summary: "",
      completedAt: "2026-06-16T00:00:00.000Z",
    };
    expect(session.avgScaffoldLevel).toBeUndefined();
  });
});
