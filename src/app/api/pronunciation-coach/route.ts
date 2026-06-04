import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, getAiClient, hasAiApiKey } from "@/lib/ai";
import type { PronunciationAssessment, PronunciationCoachFeedback } from "@/lib/types";

function fallbackFeedback(assessment: PronunciationAssessment): PronunciationCoachFeedback {
  const weakWords = assessment.words
    ?.filter((word) => (
      word.errorType &&
      word.errorType !== "None" ||
      typeof word.accuracyScore === "number" && word.accuracyScore < 75
    ))
    .slice(0, 2) ?? [];

  const tips: PronunciationCoachFeedback["tips"] = [];

  if (weakWords[0]) {
    tips.push({
      type: "pronunciation",
      target: weakWords[0].word,
      advice: `Repeat "${weakWords[0].word}" slowly, then say it again inside the full sentence.`,
      practiceText: weakWords[0].word,
    });
  }

  if (assessment.fluencyScore < 75) {
    tips.push({
      type: "naturalness",
      advice: "Keep a steady rhythm and use one short pause at the main comma or phrase break.",
      practiceText: assessment.transcript || "Say the sentence again with a steady rhythm.",
    });
  }

  if (tips.length === 0) {
    tips.push({
      type: "naturalness",
      advice: "Good work. Try saying the sentence once more with a little more confidence and flow.",
      practiceText: assessment.transcript || "Say it again with more confidence.",
    });
  }

  return {
    summary: "Focus on one small improvement before repeating the sentence.",
    tips: tips.slice(0, 2),
    retryPrompt: "Say it again slowly first, then at a natural speed.",
  };
}

function isCoachFeedback(value: unknown): value is PronunciationCoachFeedback {
  if (!value || typeof value !== "object") return false;
  const feedback = value as Partial<PronunciationCoachFeedback>;
  return (
    typeof feedback.summary === "string" &&
    typeof feedback.retryPrompt === "string" &&
    Array.isArray(feedback.tips) &&
    feedback.tips.every((tip) => (
      tip &&
      typeof tip === "object" &&
      (tip.type === "pronunciation" || tip.type === "naturalness") &&
      typeof tip.advice === "string"
    ))
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    referenceText?: string;
    transcript?: string;
    assessment?: PronunciationAssessment;
  };

  const referenceText = body.referenceText?.trim() ?? "";
  const transcript = body.transcript?.trim() ?? "";
  const assessment = body.assessment;

  if (!referenceText || !assessment) {
    return NextResponse.json({ error: "Missing referenceText or assessment" }, { status: 400 });
  }

  if (!hasAiApiKey) {
    return NextResponse.json(fallbackFeedback(assessment));
  }

  try {
    const completion = await getAiClient().chat.completions.create({
      model: AI_MODEL,
      max_tokens: 260,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a concise English pronunciation coach for B1-B2 learners. Give specific, kind feedback. Focus on pronunciation and naturalness. Return valid JSON only.",
        },
        {
          role: "user",
          content: `Reference sentence: ${JSON.stringify(referenceText)}
Recognized transcript: ${JSON.stringify(transcript)}
Assessment JSON: ${JSON.stringify({
  pronunciationScore: assessment.pronunciationScore,
  accuracyScore: assessment.accuracyScore,
  fluencyScore: assessment.fluencyScore,
  completenessScore: assessment.completenessScore,
  words: assessment.words?.slice(0, 16),
})}

Return JSON in this exact shape:
{
  "summary": "one short sentence",
  "tips": [
    {"type": "pronunciation", "target": "word or phrase", "advice": "specific advice", "practiceText": "short word, phrase, or sentence to repeat"},
    {"type": "naturalness", "target": "optional phrase", "advice": "specific advice", "practiceText": "short phrase or sentence to repeat"}
  ],
  "retryPrompt": "one short instruction for the next attempt"
}

Rules:
- Give at most 2 tips.
- Include at least one pronunciation tip when word-level errors exist.
- Include naturalness advice when fluencyScore is below 80.
- practiceText must be speakable by the learner and directly match the advice.
- Do not mention Azure, JSON, scores, or APIs.
- Keep each advice sentence under 22 words.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as unknown;

    if (isCoachFeedback(parsed)) {
      return NextResponse.json({
        ...parsed,
        tips: parsed.tips.slice(0, 2),
      });
    }
  } catch (error) {
    console.warn("[pronunciation-coach] fallback due to:", error instanceof Error ? error.message : error);
  }

  return NextResponse.json(fallbackFeedback(assessment));
}
