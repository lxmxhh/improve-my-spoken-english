import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, getAiClient, hasAiApiKey } from "@/lib/ai";
import {
  createFallbackConnectedSpeechGuide,
  normalizeConnectedSpeechGuide,
} from "@/lib/connected-speech";
import type { ConnectedSpeechGuide } from "@/lib/types";

const GUIDE_TIMEOUT_MS = Number(process.env.CONNECTED_SPEECH_GUIDE_TIMEOUT_MS) || 8_000;

function buildFallback(text: string) {
  return createFallbackConnectedSpeechGuide(text);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("connected speech guide timeout")), timeoutMs);
    }),
  ]);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    text?: string;
    previousCoachLine?: string;
    level?: "A2" | "B1" | "B2" | "C1";
  };

  const text = body.text?.replace(/\s+/g, " ").trim() ?? "";
  const previousCoachLine = body.previousCoachLine?.replace(/\s+/g, " ").trim() ?? "";
  const level = body.level ?? "B1";

  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  if (!hasAiApiKey) {
    return NextResponse.json(buildFallback(text));
  }

  try {
    const completion = await withTimeout(
      getAiClient().chat.completions.create({
        model: AI_MODEL,
        max_tokens: 420,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an English connected-speech coach. Return concise JSON only. Use plain ASCII phonetic hints when possible.",
          },
          {
            role: "user",
            content: `Learner level: ${level}
Previous coach line: ${JSON.stringify(previousCoachLine)}
Reference sentence: ${JSON.stringify(text)}

Create a Flow Coach guide for this sentence.

Return JSON in this exact shape:
{
  "text": "same sentence",
  "focusWords": [
    {"word": "word", "reason": "short reason"}
  ],
  "weakForms": [
    {"word": "word", "weakForm": "/tuh/", "strongForm": "/too/", "reason": "short reason"}
  ],
  "linkedPhrases": [
    {"text": "two or three words", "cue": "spoken-as-one cue", "type": "consonant-vowel"}
  ],
  "intonation": {
    "contour": "falling",
    "tonalWord": "word",
    "reason": "short reason"
  },
  "teachingPrompt": "one short learner-facing instruction"
}

Rules:
- Choose 1-3 focus words that carry meaning.
- Choose at most 3 weak forms, only for function words that should be light here.
- Choose at most 3 linked phrases. Use type: consonant-vowel, vowel-vowel, same-consonant, or reduction.
- Intonation contour must be falling, rising, fall-rise, or rise-fall.
- Keep every reason under 14 words.
- Do not mention JSON, APIs, Azure, algorithms, or scores.`,
          },
        ],
      }),
      GUIDE_TIMEOUT_MS
    );

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as unknown;
    const guide = normalizeConnectedSpeechGuide(parsed, text);

    if (guide) {
      return NextResponse.json(guide satisfies ConnectedSpeechGuide);
    }
  } catch (error) {
    console.warn("[connected-speech-guide] fallback due to:", error instanceof Error ? error.message : error);
  }

  return NextResponse.json(buildFallback(text));
}
