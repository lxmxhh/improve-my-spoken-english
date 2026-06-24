import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, getAiClient, hasAiApiKey } from "@/lib/ai";
import type { CoachPromptAnchor } from "@/lib/types";

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Word overlap ratio: intersection / union of unique words */
export function wordOverlap(a: string, b: string): number {
  const setA = new Set(normalize(a).split(" ").filter(Boolean));
  const setB = new Set(normalize(b).split(" ").filter(Boolean));
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Cheap, network-free verdict.
 * - false: no usable speech (empty)
 * - true:  clearly matches the reference / model answer
 * - null:  needs semantic (no anchor) or direction (anchor) judging
 */
export function quickVerdict(expected: string, actual: string, anchor?: CoachPromptAnchor): boolean | null {
  if (!actual || actual.trim().length === 0) return false;

  const reference = (anchor?.sampleAnswer ?? expected ?? "").trim();
  if (reference) {
    if (normalize(actual) === normalize(reference)) return true;
    if (wordOverlap(actual, reference) >= 0.8) return true;
  }
  return null;
}

/** Interpret the model's yes/no answer, with a lenient fail-open default. */
export function interpretAnswer(
  answer: string,
  opts: { actual: string; reference: string; hasAnchor: boolean }
): boolean {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) {
    // Empty model reply: in direction mode we cannot use overlap (valid answers
    // legitimately differ from the model answer), so fail open. Otherwise keep
    // the historical word-overlap fallback.
    return opts.hasAnchor ? true : wordOverlap(opts.actual, opts.reference) >= 0.6;
  }
  return normalized.startsWith("yes");
}

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

    const completion = await getAiClient().chat.completions.create({
      model: AI_MODEL,
      max_tokens: 20,
      messages,
    });

    const answer = completion.choices[0]?.message?.content ?? "";
    const pass = interpretAnswer(answer, { actual, reference, hasAnchor: Boolean(anchor) });
    return NextResponse.json({ pass });
  } catch {
    // Fail-open: don't block the user on API errors
    return NextResponse.json({ pass: true });
  }
}
