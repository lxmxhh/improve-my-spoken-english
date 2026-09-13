import type { CoachPromptAnchor, Script, ScriptTurn } from "./types";

export function normalizeScript(raw: unknown, fallbackCategory: string): Script {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid script shape");
  }

  const value = raw as Partial<Script>;
  if (typeof value.topic !== "string") {
    throw new Error("Invalid script shape");
  }

  const rawTurns = Array.isArray(value.turns)
    ? value.turns
    : Array.isArray((value as { lines?: unknown }).lines)
      ? (value as { lines: unknown[] }).lines
      : null;

  if (!rawTurns) {
    throw new Error("Invalid script shape");
  }

  const turns: ScriptTurn[] = rawTurns.map((turn) => {
    if (Array.isArray(turn)) {
      const [speaker, text] = turn;
      return normalizeTurn({ speaker, text });
    }

    if (!turn || typeof turn !== "object") {
      throw new Error("Invalid turn shape");
    }

    return normalizeTurn(turn);
  });

  if (turns.length < 6 || turns[0]?.speaker !== "coach") {
    throw new Error("Invalid script shape");
  }

  for (let i = 1; i < turns.length; i += 1) {
    if (turns[i].speaker === turns[i - 1].speaker) {
      throw new Error("Script must alternate speakers");
    }
  }

  return {
    topic: value.topic.trim(),
    category: typeof value.category === "string" && value.category.trim()
      ? value.category.trim()
      : fallbackCategory,
    turns,
  };
}

function parseAnchor(candidate: { text: string; intent?: unknown; keyPoints?: unknown; sampleAnswer?: unknown }): CoachPromptAnchor | undefined {
  const intent = typeof candidate.intent === "string" ? candidate.intent.trim() : "";
  const keyPoints = Array.isArray(candidate.keyPoints)
    ? candidate.keyPoints.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())
    : [];
  const sampleAnswer = typeof candidate.sampleAnswer === "string" && candidate.sampleAnswer.trim()
    ? candidate.sampleAnswer.trim()
    : candidate.text;

  if (!intent && keyPoints.length === 0) return undefined;

  return {
    intent: intent || "answer the coach's question in your own words",
    keyPoints: keyPoints.length > 0 ? keyPoints : ["respond in a full sentence"],
    sampleAnswer,
  };
}

function normalizeTurn(turn: unknown): ScriptTurn {
  const candidate = turn as {
    speaker?: unknown;
    text?: unknown;
    hint?: unknown;
    intent?: unknown;
    keyPoints?: unknown;
    sampleAnswer?: unknown;
  };
  const speaker =
    candidate.speaker === "coach" || candidate.speaker === "c" || candidate.speaker === "Alex"
      ? "coach"
      : candidate.speaker === "user" ||
          candidate.speaker === "u" ||
          candidate.speaker === "learner" ||
          candidate.speaker === "Learner"
        ? "user"
        : null;

  if (!speaker || typeof candidate.text !== "string" || !candidate.text.trim()) {
    throw new Error("Invalid turn shape");
  }

  const text = candidate.text.trim();
  const anchor = speaker === "user" ? parseAnchor({ ...candidate, text }) : undefined;

  return {
    speaker,
    text,
    ...(typeof candidate.hint === "string" && candidate.hint.trim()
      ? { hint: candidate.hint.trim() }
      : {}),
    ...(anchor ? { anchor } : {}),
  };
}
