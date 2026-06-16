import { NextResponse } from "next/server";
import { generateCachedSpeech, getErrorMessage, getTtsProvider } from "@/lib/server-tts";

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

    const audio = await generateCachedSpeech(text, {
      voice,
      qwenVoice: typeof body.qwenVoice === "string" ? body.qwenVoice : undefined,
      kokoroVoice: typeof body.kokoroVoice === "string" ? body.kokoroVoice : undefined,
    });
    return audioResponse(audio);
  } catch (error) {
    console.error("[TTS] speech generation failed", error);
    return NextResponse.json(
      {
        error: getTtsProvider() === "kokoro" ? "Kokoro local TTS failed" : "Failed to generate speech",
        details: getErrorMessage(error),
      },
      { status: getTtsProvider() === "kokoro" ? 503 : 500 }
    );
  }
}

function audioResponse(audio: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(audio), {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
