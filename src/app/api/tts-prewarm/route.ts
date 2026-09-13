import { NextResponse } from "next/server";
import { getAllRecords } from "@/lib/script-store";
import {
  getCoachLines,
  getErrorMessage,
  getPrewarmJobStatus,
  prewarmSpeechTexts,
  startPrewarmJob,
} from "@/lib/server-tts";

export const runtime = "nodejs";

/** Status of the background pool-wide prewarm job. */
export async function GET() {
  return NextResponse.json(getPrewarmJobStatus());
}

/**
 * - `{ texts: string[] }`: synchronously warm a few lines (used by the session page).
 * - `{ scope: "pool" }`: start a background job over every coach line in seed + runtime pool.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { texts?: unknown; scope?: unknown };

    if (body.scope === "pool") {
      const records = await getAllRecords();
      const texts = records.flatMap((record) => getCoachLines(record.script));
      return NextResponse.json({ ...startPrewarmJob(texts), candidates: texts.length });
    }

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
