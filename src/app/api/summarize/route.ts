import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, getAiClient, hasAiApiKey } from "@/lib/ai";
import type { Script } from "@/lib/types";

function scriptToText(script: Script): string {
  return script.turns
    .map((t) => `${t.speaker === "coach" ? "Coach" : "You"}: ${t.text}`)
    .join("\n");
}

const FALLBACK_SUMMARY =
  "Great effort today! Keep practicing every day and your English will keep improving. You're doing amazing!";

export async function POST(req: NextRequest) {
  const {
    script,
    passedLines,
    totalLines,
  }: { script: Script; passedLines: number; totalLines: number } =
    await req.json();

  if (!hasAiApiKey) {
    return NextResponse.json({ summary: FALLBACK_SUMMARY });
  }

  try {
    const completion = await getAiClient().chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: "user",
          content: `Here is a conversation script the user just practiced:

${scriptToText(script)}

The user passed ${passedLines} out of ${totalLines} lines.

Generate a brief end-of-session summary with:
1. 3-5 vocabulary words from this conversation worth remembering (with simple definitions)
2. 1-2 gentle grammar tips based on common mistakes for this level (phrased positively, e.g. "Try saying '...' next time")
3. One encouraging closing sentence

Reply in plain text, not JSON. Keep it concise and friendly.`,
        },
      ],
    });

    const summary =
      completion.choices[0]?.message?.content?.trim() ?? FALLBACK_SUMMARY;
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ summary: FALLBACK_SUMMARY });
  }
}
