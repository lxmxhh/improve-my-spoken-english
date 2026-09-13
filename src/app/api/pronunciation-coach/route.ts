import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, getAiClient, hasAiApiKey, withChatDefaults } from "@/lib/ai";
import {
  analyzeConnectedSpeech,
  normalizeConnectedSpeechGuide,
} from "@/lib/connected-speech";
import { freeFallbackFeedback } from "@/lib/coach-feedback";
import type {
  ConnectedSpeechAnalysis,
  ConnectedSpeechGuide,
  PronunciationAssessment,
  PronunciationCoachFeedback,
} from "@/lib/types";

function fallbackFeedback(
  assessment: PronunciationAssessment | undefined,
  guide?: ConnectedSpeechGuide,
  analysis?: ConnectedSpeechAnalysis,
  referenceText = "",
  transcript = ""
): PronunciationCoachFeedback {
  const weakWords = assessment?.words
    ?.filter((word) => (
      word.errorType &&
      word.errorType !== "None" ||
      typeof word.accuracyScore === "number" && word.accuracyScore < 75
    ))
    .slice(0, 2) ?? [];

  const tips: PronunciationCoachFeedback["tips"] = [];
  const flowAnalysis = assessment ? analysis ?? analyzeConnectedSpeech(assessment, guide) : analysis;

  if (weakWords[0]) {
    tips.push({
      type: "pronunciation",
      target: weakWords[0].word,
      advice: `Repeat "${weakWords[0].word}" slowly, then say it again inside the full sentence.`,
      practiceText: weakWords[0].word,
    });
  }

  if (flowAnalysis?.topIssue && flowAnalysis.topIssue !== "pronunciation" && tips.length < 2) {
    tips.push({
      type: "naturalness",
      target: guide?.linkedPhrases[0]?.text || guide?.weakForms[0]?.word,
      advice: flowAnalysis.priorityReason,
      practiceText: flowAnalysis.suggestedPracticeText || guide?.text || assessment?.transcript,
    });
  } else if (assessment && assessment.fluencyScore < 75) {
    tips.push({
      type: "naturalness",
      advice: "Keep a steady rhythm and use one short pause at the main comma or phrase break.",
      practiceText: assessment.transcript || "Say the sentence again with a steady rhythm.",
    });
  } else if (!assessment && guide?.linkedPhrases[0]) {
    tips.push({
      type: "naturalness",
      target: guide.linkedPhrases[0].text,
      advice: `Try saying "${guide.linkedPhrases[0].text}" as one smooth chunk.`,
      practiceText: guide.linkedPhrases[0].text,
    });
  } else if (!assessment && guide?.weakForms[0]) {
    tips.push({
      type: "naturalness",
      target: guide.weakForms[0].word,
      advice: `Keep "${guide.weakForms[0].word}" light so the main words stand out.`,
      practiceText: referenceText || transcript,
    });
  }

  if (tips.length === 0) {
    tips.push({
      type: "naturalness",
      advice: "Good work. Try saying the sentence once more with a little more confidence and flow.",
      practiceText: assessment?.transcript || referenceText || "Say it again with more confidence.",
    });
  }

  return {
    summary: "Focus on one small improvement before repeating the sentence.",
    tips: tips.slice(0, 2),
    retryPrompt: "Say it again slowly first, then at a natural speed.",
  };
}

async function handleFreeExpression(
  transcript: string,
  question: string,
  modelAnswer: string
): Promise<PronunciationCoachFeedback> {
  if (!hasAiApiKey || !transcript) {
    return freeFallbackFeedback(transcript);
  }

  try {
    const completion = await getAiClient().chat.completions.create(withChatDefaults({
      model: AI_MODEL,
      max_tokens: 260,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a warm, concise English speaking coach for B1-B2 learners practicing free speaking. The learner answered a question in their OWN words. Evaluate the sentence THEY said — never grade it against a fixed answer. Return valid JSON only.",
        },
        {
          role: "user",
          content: `The coach asked: ${JSON.stringify(question)}
The learner said: ${JSON.stringify(transcript)}
A natural model answer, for YOUR reference only (do NOT require the learner to match it): ${JSON.stringify(modelAnswer)}

Give feedback ON WHAT THE LEARNER SAID:
{
  "summary": "one warm sentence: does their answer fit the question, said naturally?",
  "tips": [
    {"type": "naturalness", "target": "their word or phrase", "advice": "improve THEIR sentence: grammar, word choice, or natural phrasing", "practiceText": "a short improved version of THEIR phrase to repeat"}
  ],
  "retryPrompt": "one short encouraging instruction"
}

Rules:
- Coach THEIR sentence, quoting their words. Do not tell them to say the model answer.
- At most 2 tips. If their sentence is already good, say so and offer one small upgrade.
- practiceText must be a short, speakable improvement of THEIR own words.
- If their answer is off-topic, gently point them back to the question.
- Do not mention the model answer, Azure, JSON, scores, or APIs.
- Keep each advice under 22 words.`,
        },
      ],
    }));

    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "") as unknown;
    if (isCoachFeedback(parsed)) {
      return { ...parsed, tips: parsed.tips.slice(0, 2) };
    }
  } catch (error) {
    console.warn("[pronunciation-coach:free] fallback due to:", error instanceof Error ? error.message : error);
  }
  return freeFallbackFeedback(transcript);
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
    connectedSpeechGuide?: unknown;
    connectedSpeechAnalysis?: ConnectedSpeechAnalysis;
    mode?: "free";
    question?: string;
    modelAnswer?: string;
  };

  const referenceText = body.referenceText?.trim() ?? "";
  const transcript = body.transcript?.trim() ?? "";

  // Free-expression (practice) coaching: judge the learner's own sentence,
  // not the model answer.
  if (body.mode === "free") {
    return NextResponse.json(
      await handleFreeExpression(transcript, body.question?.trim() ?? "", body.modelAnswer?.trim() ?? "")
    );
  }
  const assessment = body.assessment;
  const connectedSpeechGuide = normalizeConnectedSpeechGuide(body.connectedSpeechGuide, referenceText) ?? undefined;
  const connectedSpeechAnalysis = body.connectedSpeechAnalysis ?? (
    assessment ? analyzeConnectedSpeech(assessment, connectedSpeechGuide) : undefined
  );

  if (!referenceText) {
    return NextResponse.json({ error: "Missing referenceText" }, { status: 400 });
  }

  if (!hasAiApiKey) {
    return NextResponse.json(fallbackFeedback(assessment, connectedSpeechGuide, connectedSpeechAnalysis, referenceText, transcript));
  }

  try {
    const completion = await getAiClient().chat.completions.create(withChatDefaults({
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
  pronunciationScore: assessment?.pronunciationScore,
  accuracyScore: assessment?.accuracyScore,
  fluencyScore: assessment?.fluencyScore,
  completenessScore: assessment?.completenessScore,
  words: assessment?.words?.slice(0, 16),
})}
Flow Coach guide: ${JSON.stringify(connectedSpeechGuide ?? null)}
Flow priority: ${JSON.stringify(connectedSpeechAnalysis ?? null)}

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
- If assessment is missing, give practice-mode coaching from transcript, reference sentence, and Flow Coach guide only.
- Include naturalness advice when fluencyScore is below 80 or Flow priority is linking, rhythm, weak-forms, or intonation.
- When Flow Coach guide is available, make one tip target the top Flow priority unless pronunciation errors are more urgent.
- For linking or rhythm, practiceText should be the shortest linked phrase or chunk, not the whole sentence.
- For weak forms, name the small word and contrast the light form with the strong form.
- For intonation, connect the tone to the speaker's meaning.
- practiceText must be speakable by the learner and directly match the advice.
- Do not mention Azure, JSON, scores, or APIs.
- Keep each advice sentence under 22 words.`,
        },
      ],
    }));

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

  return NextResponse.json(fallbackFeedback(assessment, connectedSpeechGuide, connectedSpeechAnalysis, referenceText, transcript));
}
