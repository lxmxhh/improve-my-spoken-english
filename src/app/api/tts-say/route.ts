import { NextResponse } from "next/server";
import { generateCachedSpeech, getErrorMessage, type GeneratedSpeech } from "@/lib/server-tts";

export const runtime = "nodejs";

const ALLOWED_VOICES = new Set(["Samantha", "Alex", "Ava", "Nicky", "Susan"]);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = String(body.text ?? "").trim();
    const requestedVoice = String(body.voice ?? "Samantha");
    const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : "Samantha";

    if (!text) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    const speech = await generateCachedSpeech(text, {
      voice,
      qwenVoice: typeof body.qwenVoice === "string" ? body.qwenVoice : undefined,
    });
    return audioResponse(speech);
  } catch (error) {
    console.error("[TTS] speech generation failed", error);
    return NextResponse.json(
      { error: "Failed to generate speech", details: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

function audioResponse({ audio, contentType }: GeneratedSpeech): NextResponse {
  return new NextResponse(new Uint8Array(audio), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
