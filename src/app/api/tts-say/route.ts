import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const CACHE_DIR = join(process.cwd(), ".next", "tts-cache");
const ALLOWED_VOICES = new Set(["Samantha", "Alex", "Ava", "Nicky", "Susan"]);
const DEBUG_TTS = process.env.DEBUG_TTS === "1";

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

    // Return cached WAV if it exists
    try {
      const audio = await readFile(wavPath);
      if (DEBUG_TTS) console.log("[TTS] cache hit", hash);
      return new NextResponse(audio, {
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      // Cache miss; generate below.
    }

    // Step 1: say → AIFF (native macOS format)
    // Step 2: afconvert → proper RIFF/WAV (Chrome-compatible)
    const aiffPath = join(CACHE_DIR, `${hash}.aiff`);
    if (DEBUG_TTS) console.log("[TTS] generating", voice, safeText.slice(0, 40));

    await execFileAsync("say", ["-v", voice, "-o", aiffPath, safeText]);
    await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", aiffPath, wavPath]);
    await unlink(aiffPath).catch(() => {});

    const audio = await readFile(wavPath);
    if (DEBUG_TTS) console.log("[TTS] generated", audio.length, "bytes");
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[TTS] macOS say/afconvert failed", error);
    return NextResponse.json({ error: "Failed to generate speech" }, { status: 500 });
  }
}
