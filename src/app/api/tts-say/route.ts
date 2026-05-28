import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const CACHE_DIR = join(process.cwd(), ".next", "tts-cache");
const ALLOWED_VOICES = new Set(["Samantha", "Alex", "Ava", "Nicky", "Susan"]);
const DEBUG_TTS = process.env.DEBUG_TTS === "1";
const TTS_PROVIDER = process.env.TTS_PROVIDER ?? "qwen";
const QWEN_TTS_BASE_URL =
  process.env.QWEN_TTS_BASE_URL ?? "https://dashscope.aliyuncs.com/api/v1";
const QWEN_TTS_MODEL = process.env.QWEN_TTS_MODEL ?? "qwen3-tts-flash";
const QWEN_TTS_VOICE = process.env.QWEN_TTS_VOICE ?? "Ethan"; // “Vivian:Cherry”
const QWEN_TTS_LANGUAGE = process.env.QWEN_TTS_LANGUAGE ?? "English";
const QWEN_TTS_API_KEY =
  process.env.QWEN_TTS_API_KEY ??
  process.env.DASHSCOPE_API_KEY ??
  process.env.AI_API_KEY ??
  "";

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
    const provider = TTS_PROVIDER === "macos" ? "macos" : "qwen";
    const qwenVoice = String(body.qwenVoice ?? QWEN_TTS_VOICE);
    const cacheVoice = provider === "qwen" ? qwenVoice : voice;
    const cacheModel = provider === "qwen" ? QWEN_TTS_MODEL : "macos-say";
    const hash = createHash("sha256")
      .update(`${provider}:${cacheModel}:${cacheVoice}:${safeText}`)
      .digest("hex")
      .slice(0, 24);
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

    if (provider === "qwen" && QWEN_TTS_API_KEY.trim()) {
      try {
        const audio = await generateQwenSpeech(safeText, qwenVoice);
        await writeFile(wavPath, audio);
        if (DEBUG_TTS) console.log("[TTS] qwen generated", audio.length, "bytes");
        return audioResponse(audio);
      } catch (error) {
        console.error("[TTS] Qwen-TTS failed, falling back to macOS", error);
      }
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
    return audioResponse(audio);
  } catch (error) {
    console.error("[TTS] speech generation failed", error);
    return NextResponse.json({ error: "Failed to generate speech" }, { status: 500 });
  }
}

async function generateQwenSpeech(text: string, voice: string): Promise<Buffer> {
  const response = await fetch(`${QWEN_TTS_BASE_URL}/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${QWEN_TTS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: QWEN_TTS_MODEL,
      input: {
        text,
        voice,
        language_type: QWEN_TTS_LANGUAGE,
      },
    }),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || result?.output?.audio?.url == null) {
    throw new Error(result?.message || result?.code || `Qwen-TTS ${response.status}`);
  }

  const audioResponse = await fetch(result.output.audio.url);
  if (!audioResponse.ok) {
    throw new Error(`Qwen-TTS audio download ${audioResponse.status}`);
  }

  return Buffer.from(await audioResponse.arrayBuffer());
}

function audioResponse(audio: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(audio), {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
