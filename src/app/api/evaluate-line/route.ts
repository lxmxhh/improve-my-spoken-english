import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, getAiClient, hasAiApiKey, withChatDefaults } from "@/lib/ai";
import { interpretAnswer, quickVerdict } from "@/lib/answer-check";
import type { CoachPromptAnchor } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { expected, actual, anchor } = (await req.json()) as {
    expected: string;
    actual: string;
    anchor?: CoachPromptAnchor;
  };

  const quick = quickVerdict(expected, actual, anchor);
  if (quick !== null) {
    return NextResponse.json({ pass: quick });
  }

  // Cannot judge without the model — fail open.
  if (!hasAiApiKey) {
    return NextResponse.json({ pass: true });
  }

  const reference = (anchor?.sampleAnswer ?? expected ?? "").trim();

  try {
    const messages = anchor
      ? [
          {
            role: "system" as const,
            content:
              "You are a lenient English speaking coach. Judge ONLY whether the learner's answer is on-topic and addresses the question's direction. Do NOT judge grammar, vocabulary, or pronunciation. Accept any reasonable, relevant answer even if short or imperfect. If you are unsure, answer yes.",
          },
          {
            role: "user" as const,
            content: `The coach wanted the learner to: ${anchor.intent}
Acceptable directions: ${anchor.keyPoints.join("; ")}
A model answer (one of many valid answers): "${reference}"
Learner said: "${actual}"
Is the learner's answer a relevant, on-topic response to the question? Reply with only: yes or no`,
          },
        ]
      : [
          {
            role: "system" as const,
            content:
              "You are a lenient English speaking coach evaluator. Be generous — accept paraphrases, synonyms, different word order, and minor grammar differences as correct.",
          },
          {
            role: "user" as const,
            content: `Reference sentence: "${expected}"
Learner said: "${actual}"
Does the learner's sentence convey the same meaning as the reference? Reply with only: yes or no`,
          },
        ];

    const completion = await getAiClient().chat.completions.create(withChatDefaults({
      model: AI_MODEL,
      max_tokens: 20,
      messages,
    }));

    const answer = completion.choices[0]?.message?.content ?? "";
    const pass = interpretAnswer(answer, { actual, reference, hasAnchor: Boolean(anchor) });
    return NextResponse.json({ pass });
  } catch {
    // Fail-open: don't block the user on API errors
    return NextResponse.json({ pass: true });
  }
}
