import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, getAiClient, hasAiApiKey } from "@/lib/ai";
import { ensureAnchors } from "@/lib/anchor";
import FALLBACK_SCRIPTS from "@/lib/fallback-scripts";
import type { CoachPromptAnchor, Script, ScriptTurn } from "@/lib/types";

const GENERATE_TIMEOUT_MS =
  Number(process.env.GENERATE_SCRIPT_TIMEOUT_MS) || 25_000;

const CATEGORIES = [
  "Daily Life",
  "Work & Career",
  "News & Society",
  "Entertainment & Culture",
];

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
      max_tokens: 900,
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

IMPORTANT — keep coach turns self-contained so the learner can answer freely:
- Each COACH turn must be a question about the topic that makes sense no matter how the learner answered the previous turn.
- Do NOT have the coach react to or restate the specific content of the learner's expected answer (e.g. avoid "Checking your phone is common — do you read news too?").
- A short neutral acknowledgment ("Great." / "Thanks.") before a new question is fine, but the question itself must stand on its own.
- The questions should still progress naturally through the topic, like an interviewer asking a related series of questions.

For every USER turn, also provide:
- "intent": the communicative function in a few words (e.g. "describe a past routine", "give an opinion").
- "keyPoints": 2-3 short acceptable answer directions a learner could mention (not exact wording).
- "sampleAnswer": one natural model answer (this is the same idea as "text").
Coach turns must NOT include intent/keyPoints/sampleAnswer.

Return valid JSON with this exact shape:
{
  "topic": "string",
  "category": "string",
  "turns": [
    { "speaker": "coach", "text": "string" },
    { "speaker": "user", "text": "string", "intent": "string", "keyPoints": ["string"], "sampleAnswer": "string" }
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
    const script = ensureAnchors(normalizeScript(JSON.parse(raw), resolvedCategory));

    return NextResponse.json(script);
  } catch (error) {
    console.warn("[generate-script] fallback due to:", error instanceof Error ? error.message : error);
    // Fall back to a hardcoded script for the requested category
    const fallback =
      FALLBACK_SCRIPTS.find((s) => s.category === resolvedCategory) ??
      FALLBACK_SCRIPTS[0];
    return NextResponse.json(ensureAnchors(fallback));
  }
}
