import { NextResponse } from "next/server";
import { getErrorMessage, prewarmSpeechTexts } from "@/lib/server-tts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { texts?: unknown };
    const texts = Array.isArray(body.texts)
      ? body.texts.map((text: unknown) => String(text)).filter((text: string) => text.trim())
      : [];

    if (texts.length === 0) {
      return NextResponse.json({ error: "Missing texts" }, { status: 400 });
    }

    await prewarmSpeechTexts(texts.slice(0, 12));
    return NextResponse.json({ ok: true, count: texts.length });
  } catch (error) {
    console.error("[TTS] prewarm failed", error);
    return NextResponse.json(
      { error: "Failed to prewarm speech", details: getErrorMessage(error) },
      { status: 503 }
    );
  }
}
