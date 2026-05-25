import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const CACHE_DIR = join(process.cwd(), ".next", "tts-cache");
const ALLOWED_VOICES = new Set(["Samantha", "Alex", "Ava", "Nicky", "Susan"]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text = String(body.text ?? "").trim();
    const requestedVoice = String(body.voice ?? "Samantha");
    const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : "Samantha";

    if (!text) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    const safeText = text.slice(0, 600);
    const hash = createHash("sha256").update(`${voice}:${safeText}`).digest("hex").slice(0, 24);
    const wavPath = join(CACHE_DIR, `${hash}.wav`);

    await mkdir(CACHE_DIR, { recursive: true });

    try {
      const audio = await readFile(wavPath);
      return new NextResponse(audio, {
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      // Cache miss; generate below.
    }

    await execFileAsync("say", [
      "-v",
      voice,
      "-o",
      wavPath,
      "--data-format=LEI16@22050",
      safeText,
    ]);

    const audio = await readFile(wavPath);
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[TTS] macOS say failed", error);
    return NextResponse.json({ error: "Failed to generate speech" }, { status: 500 });
  }
}
