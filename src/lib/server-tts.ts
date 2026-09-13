import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Script } from "./types";

const execFileAsync = promisify(execFile);
const CACHE_DIR = process.env.TTS_CACHE_DIR ?? join(process.cwd(), "data", "tts-cache");
const ALLOWED_PROVIDER_NAMES = new Set(["qwen", "macos"]);
const DEBUG_TTS = process.env.DEBUG_TTS === "1";
const TTS_PROVIDER = process.env.TTS_PROVIDER ?? "qwen";
// "multimodal": DashScope Qwen3-TTS (services/aigc/multimodal-generation/generation).
// "speech-synthesizer": Token Plan / CosyVoice (services/audio/tts/SpeechSynthesizer).
const QWEN_TTS_API: QwenTtsApi =
  process.env.QWEN_TTS_API === "speech-synthesizer" ? "speech-synthesizer" : "multimodal";
const QWEN_TTS_BASE_URL =
  process.env.QWEN_TTS_BASE_URL ?? "https://dashscope.aliyuncs.com/api/v1";
const QWEN_TTS_MODEL = process.env.QWEN_TTS_MODEL ?? "qwen3-tts-flash";
const QWEN_TTS_VOICE = process.env.QWEN_TTS_VOICE ?? "Ethan";
const QWEN_TTS_LANGUAGE = process.env.QWEN_TTS_LANGUAGE ?? "English";
const QWEN_TTS_FORMAT: AudioFormat = process.env.QWEN_TTS_FORMAT === "mp3" ? "mp3" : "wav";
const QWEN_TTS_API_KEY =
  process.env.QWEN_TTS_API_KEY ??
  process.env.DASHSCOPE_API_KEY ??
  process.env.AI_API_KEY ??
  "";

export type TtsProvider = "qwen" | "macos";
type QwenTtsApi = "multimodal" | "speech-synthesizer";
type AudioFormat = "wav" | "mp3";

const CONTENT_TYPES: Record<AudioFormat, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
};

export interface GeneratedSpeech {
  audio: Buffer;
  contentType: string;
}

interface SpeechOptions {
  voice?: string;
  qwenVoice?: string;
}

interface SpeechTarget {
  text: string;
  voice?: string;
  qwenVoice?: string;
}

interface CacheTarget {
  text: string;
  provider: TtsProvider;
  cacheModel: string;
  cacheVoice: string;
  format: AudioFormat;
  audioPath: string;
  voice: string;
  qwenVoice: string;
}

export function getTtsProvider(): TtsProvider {
  const normalized = TTS_PROVIDER.trim().toLowerCase();
  return ALLOWED_PROVIDER_NAMES.has(normalized) ? (normalized as TtsProvider) : "qwen";
}

export async function generateCachedSpeech(
  text: string,
  options: SpeechOptions = {}
): Promise<GeneratedSpeech> {
  const safeText = text.trim().slice(0, 600);
  if (!safeText) throw new Error("Missing text");

  const target = getCacheTarget({ text: safeText, ...options });
  await mkdir(CACHE_DIR, { recursive: true });

  const cached = await readCachedAudio(target.audioPath);
  if (cached) return { audio: cached, contentType: CONTENT_TYPES[target.format] };

  if (target.provider === "qwen" && QWEN_TTS_API_KEY.trim()) {
    try {
      const audio = await generateQwenSpeech(safeText, target.qwenVoice);
      await writeFile(target.audioPath, audio);
      if (DEBUG_TTS) console.log("[TTS] qwen generated", audio.length, "bytes");
      return { audio, contentType: CONTENT_TYPES[target.format] };
    } catch (error) {
      console.error("[TTS] Qwen-TTS failed, falling back to macOS", error);
    }
  }

  // Fallback providers always produce wav, regardless of the configured qwen format.
  const wavPath = target.audioPath.replace(/\.[a-z0-9]+$/, ".wav");

  await generateMacSpeech({
    text: safeText,
    voice: target.voice,
    outputPath: wavPath,
  });
  return { audio: await readFile(wavPath), contentType: CONTENT_TYPES.wav };
}

export async function prewarmCoachAudioForScript(script: Script): Promise<void> {
  await prewarmSpeechTexts(script.turns
    .filter((turn) => turn.speaker === "coach")
    .map((turn) => turn.text));
}

export async function prewarmSpeechTexts(texts: string[]): Promise<void> {
  const seenPaths = new Set<string>();
  const targets = texts
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => getCacheTarget({ text }))
    .filter((target) => {
      if (seenPaths.has(target.audioPath)) return false;
      seenPaths.add(target.audioPath);
      return true;
    });
  await prewarmSpeechTargets(targets);
}

async function prewarmSpeechTargets(targets: CacheTarget[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });

  const missing: CacheTarget[] = [];
  for (const target of targets) {
    if (await hasCachedAudio(target.audioPath)) continue;
    missing.push(target);
  }

  if (missing.length === 0) return;

  for (const target of missing) {
    await generateCachedSpeech(target.text, {
      voice: target.voice,
      qwenVoice: target.qwenVoice,
    });
  }
}

function getCacheTarget({
  text,
  voice = "Samantha",
  qwenVoice = QWEN_TTS_VOICE,
}: SpeechTarget): CacheTarget {
  const safeText = text.trim().slice(0, 600);
  const provider = getTtsProvider();
  const cacheVoice = provider === "qwen" ? qwenVoice : voice;
  const cacheModel = provider === "qwen" ? QWEN_TTS_MODEL : "macos-say";
  const format: AudioFormat = provider === "qwen" ? QWEN_TTS_FORMAT : "wav";
  // Keep the legacy hash input for wav so existing cache files stay valid.
  const hashInput =
    format === "wav"
      ? `${provider}:${cacheModel}:${cacheVoice}:${safeText}`
      : `${provider}:${cacheModel}:${cacheVoice}:${format}:${safeText}`;
  const hash = createHash("sha256").update(hashInput).digest("hex").slice(0, 24);

  return {
    text: safeText,
    provider,
    cacheModel,
    cacheVoice,
    format,
    audioPath: join(CACHE_DIR, `${hash}.${format}`),
    voice,
    qwenVoice,
  };
}

async function hasCachedAudio(audioPath: string) {
  try {
    await readFile(audioPath);
    return true;
  } catch {
    return false;
  }
}

async function readCachedAudio(audioPath: string): Promise<Buffer | null> {
  try {
    const audio = await readFile(audioPath);
    if (DEBUG_TTS) console.log("[TTS] cache hit", audioPath);
    return audio;
  } catch {
    return null;
  }
}

async function generateMacSpeech({
  text,
  voice,
  outputPath,
}: {
  text: string;
  voice: string;
  outputPath: string;
}): Promise<void> {
  const aiffPath = `${outputPath}.aiff`;
  await execFileAsync("say", ["-v", voice, "-o", aiffPath, text]);
  await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", aiffPath, outputPath]);
  await unlink(aiffPath).catch(() => {});
}

function getQwenRequest(text: string, voice: string): { url: string; body: unknown } {
  if (QWEN_TTS_API === "speech-synthesizer") {
    return {
      url: `${QWEN_TTS_BASE_URL}/services/audio/tts/SpeechSynthesizer`,
      body: {
        model: QWEN_TTS_MODEL,
        input: { text, voice, format: QWEN_TTS_FORMAT },
      },
    };
  }

  return {
    url: `${QWEN_TTS_BASE_URL}/services/aigc/multimodal-generation/generation`,
    body: {
      model: QWEN_TTS_MODEL,
      input: { text, voice, language_type: QWEN_TTS_LANGUAGE },
    },
  };
}

async function generateQwenSpeech(text: string, voice: string): Promise<Buffer> {
  const request = getQwenRequest(text, voice);
  const response = await fetch(request.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${QWEN_TTS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request.body),
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

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
