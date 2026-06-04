import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, getAiClient, hasAiApiKey } from "@/lib/ai";

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Word overlap ratio: intersection / union of unique words */
function wordOverlap(a: string, b: string): number {
  const setA = new Set(normalize(a).split(" ").filter(Boolean));
  const setB = new Set(normalize(b).split(" ").filter(Boolean));
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export async function POST(req: NextRequest) {
  const { expected, actual } = await req.json();

  // No speech detected — fail immediately without API call
  if (!actual || actual.trim().length === 0) {
    return NextResponse.json({ pass: false });
  }

  // Short-circuit: exact match after normalization
  if (normalize(actual) === normalize(expected)) {
    return NextResponse.json({ pass: true });
  }

  // Short-circuit: high word overlap (≥80%) — passes without API call
  if (wordOverlap(actual, expected) >= 0.8) {
    console.log("[evaluate-line] passed via word-overlap:", wordOverlap(actual, expected).toFixed(2));
    return NextResponse.json({ pass: true });
  }

  if (!hasAiApiKey) {
    return NextResponse.json({ pass: true });
  }

  try {
    const completion = await getAiClient().chat.completions.create({
      model: AI_MODEL,
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "You are a lenient English speaking coach evaluator. Be generous — accept paraphrases, synonyms, different word order, and minor grammar differences as correct.",
        },
        {
          role: "user",
          content: `Reference sentence: "${expected}"
Learner said: "${actual}"
Does the learner's sentence convey the same meaning as the reference? Reply with only: yes or no`,
        },
      ],
    });

    const answer = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
    console.log("[evaluate-line] expected:", expected);
    console.log("[evaluate-line] actual:  ", actual);
    console.log("[evaluate-line] model answer:", JSON.stringify(answer));

    // If model returned empty string, fall back to word overlap
    if (!answer) {
      const overlap = wordOverlap(actual, expected);
      console.log("[evaluate-line] empty answer, fallback overlap:", overlap.toFixed(2));
      return NextResponse.json({ pass: overlap >= 0.6 });
    }

    console.log("[evaluate-line] pass:", answer.startsWith("yes"));
    return NextResponse.json({ pass: answer.startsWith("yes") });
  } catch {
    // Fail-open: don't block the user on API errors
    return NextResponse.json({ pass: true });
  }
}
