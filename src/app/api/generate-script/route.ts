import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, getAiClient, hasAiApiKey } from "@/lib/ai";
import FALLBACK_SCRIPTS from "@/lib/fallback-scripts";
import type { Script, ScriptTurn } from "@/lib/types";

const GENERATE_TIMEOUT_MS =
  Number(process.env.GENERATE_SCRIPT_TIMEOUT_MS) || 25_000;

const CATEGORIES = [
  "Daily Life",
  "Work & Career",
  "News & Society",
  "Entertainment & Culture",
];

function normalizeScript(raw: unknown, fallbackCategory: string): Script {
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

function normalizeTurn(turn: unknown): ScriptTurn {
  const candidate = turn as {
    speaker?: unknown;
    text?: unknown;
    hint?: unknown;
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

  return {
    speaker,
    text: candidate.text.trim(),
    ...(typeof candidate.hint === "string" && candidate.hint.trim()
      ? { hint: candidate.hint.trim() }
      : {}),
  };
}

export async function POST(req: NextRequest) {
  const { category, topic } = await req.json();
  const resolvedCategory =
    CATEGORIES.includes(category) ? category : CATEGORIES[0];

  const prompt = topic
    ? `Generate a natural spoken English conversation between an encouraging coach named Alex and a B1-B2 level English learner on the specific topic: "${topic}" (category: ${resolvedCategory}).`
    : `Generate a natural spoken English conversation between an encouraging coach named Alex and a B1-B2 level English learner. Choose an interesting topic within the category: "${resolvedCategory}".`;

  try {
    if (!hasAiApiKey) {
      throw new Error("AI_API_KEY is not configured");
    }

    const completionPromise = getAiClient().chat.completions.create({
      model: AI_MODEL,
      max_tokens: 360,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate concise English conversation practice scripts. Always reply with valid JSON only.",
        },
        {
          role: "user",
          content: `${prompt}
Create exactly 8 turns total, alternating coach then user.
Each turn must be one short sentence, 8-16 words.
Use speaker values exactly: "coach" and "user".
Do not include a "hint" field.

Return valid JSON with this exact shape:
{
  "topic": "string",
  "category": "string",
  "lines": [
    ["coach", "string"],
    ["user", "string"]
  ]
}`,
        },
      ],
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("generate-script timeout")), GENERATE_TIMEOUT_MS);
    });

    const completion = await Promise.race([completionPromise, timeoutPromise]);

    const raw = completion.choices[0]?.message?.content ?? "";
    const script = normalizeScript(JSON.parse(raw), resolvedCategory);

    return NextResponse.json(script);
  } catch (error) {
    console.warn("[generate-script] fallback due to:", error instanceof Error ? error.message : error);
    // Fall back to a hardcoded script for the requested category
    const fallback =
      FALLBACK_SCRIPTS.find((s) => s.category === resolvedCategory) ??
      FALLBACK_SCRIPTS[0];
    return NextResponse.json(fallback);
  }
}
