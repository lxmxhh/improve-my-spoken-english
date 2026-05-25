import { NextRequest, NextResponse } from "next/server";
import { openrouter, MODEL } from "@/lib/ai";
import FALLBACK_SCRIPTS from "@/lib/fallback-scripts";
import type { Script } from "@/lib/types";

const CATEGORIES = [
  "Daily Life",
  "Work & Career",
  "News & Society",
  "Entertainment & Culture",
];

export async function POST(req: NextRequest) {
  const { category, topic } = await req.json();
  const resolvedCategory =
    CATEGORIES.includes(category) ? category : CATEGORIES[0];

  const prompt = topic
    ? `Generate a natural spoken English conversation between an encouraging coach named Alex and a B1-B2 level English learner on the specific topic: "${topic}" (category: ${resolvedCategory}).`
    : `Generate a natural spoken English conversation between an encouraging coach named Alex and a B1-B2 level English learner. Choose an interesting topic within the category: "${resolvedCategory}".`;

  try {
    const completion = await openrouter.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate English conversation practice scripts. Always reply with valid JSON only.",
        },
        {
          role: "user",
          content: `${prompt}
The conversation should last about 5 minutes when spoken aloud (10–14 exchanges total, alternating coach then user).
Coach lines: 1–3 sentences, natural and encouraging.
User lines: 1–2 sentences, conversational B1-B2 level.

Return valid JSON with this exact shape:
{
  "topic": "string",
  "category": "string",
  "turns": [
    { "speaker": "coach", "text": "string" },
    { "speaker": "user", "text": "string", "hint": "string" }
  ]
}
The "hint" field on user turns must be identical to "text".`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const script: Script = JSON.parse(raw);

    // Basic validation
    if (
      typeof script.topic !== "string" ||
      !Array.isArray(script.turns) ||
      script.turns.length < 4
    ) {
      throw new Error("Invalid script shape");
    }

    return NextResponse.json(script);
  } catch {
    // Fall back to a hardcoded script for the requested category
    const fallback =
      FALLBACK_SCRIPTS.find((s) => s.category === resolvedCategory) ??
      FALLBACK_SCRIPTS[0];
    return NextResponse.json(fallback);
  }
}
