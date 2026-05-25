import { NextRequest, NextResponse } from "next/server";
import { openrouter, MODEL } from "@/lib/ai";

export async function POST(req: NextRequest) {
  const { expected, actual } = await req.json();

  // No speech detected — fail immediately without API call
  if (!actual || actual.trim().length === 0) {
    return NextResponse.json({ pass: false });
  }

  try {
    const completion = await openrouter.chat.completions.create({
      model: MODEL,
      max_tokens: 5,
      messages: [
        {
          role: "user",
          content: `Expected: "${expected}"
User said: "${actual}"
Did the user express the same core meaning? Reply with only: yes or no`,
        },
      ],
    });

    const answer = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
    return NextResponse.json({ pass: answer.startsWith("yes") });
  } catch {
    // Fail-open: don't block the user on API errors
    return NextResponse.json({ pass: true });
  }
}
