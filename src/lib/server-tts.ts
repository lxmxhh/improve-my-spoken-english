import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Script } from "./types";

const execFileAsync = promisify(execFile);
const CACHE_DIR = join(process.cwd(), "data", "tts-cache");
const ALLOWED_PROVIDER_NAMES = new Set(["qwen", "macos", "kokoro"]);
const DEBUG_TTS = process.env.DEBUG_TTS === "1";
const TTS_PROVIDER = process.env.TTS_PROVIDER ?? "qwen";
const QWEN_TTS_BASE_URL =
  process.env.QWEN_TTS_BASE_URL ?? "https://dashscope.aliyuncs.com/api/v1";
const QWEN_TTS_MODEL = process.env.QWEN_TTS_MODEL ?? "qwen3-tts-flash";
const QWEN_TTS_VOICE = process.env.QWEN_TTS_VOICE ?? "Ethan";
const QWEN_TTS_LANGUAGE = process.env.QWEN_TTS_LANGUAGE ?? "English";
const QWEN_TTS_API_KEY =
  process.env.QWEN_TTS_API_KEY ??
  process.env.DASHSCOPE_API_KEY ??
  process.env.AI_API_KEY ??
  "";
const KOKORO_MODEL = "kokoro-82m";
const KOKORO_PYTHON = process.env.KOKORO_PYTHON ?? "python3";
const KOKORO_SCRIPT = process.env.KOKORO_SCRIPT ?? join(process.cwd(), "scripts", "tts", "kokoro_tts.py");
const KOKORO_VOICE = process.env.KOKORO_VOICE ?? "af_heart";
const KOKORO_LANG = process.env.KOKORO_LANG ?? "a";
const KOKORO_SPEED = Number(process.env.KOKORO_SPEED ?? "1");
const KOKORO_TIMEOUT_MS = Number(process.env.KOKORO_TIMEOUT_MS ?? "30000");

export type TtsProvider = "qwen" | "macos" | "kokoro";

interface SpeechOptions {
  voice?: string;
  qwenVoice?: string;
  kokoroVoice?: string;
}

interface SpeechTarget {
  text: string;
  voice?: string;
  qwenVoice?: string;
  kokoroVoice?: string;
}

interface CacheTarget {
  text: string;
  provider: TtsProvider;
  cacheModel: string;
  cacheVoice: string;
  wavPath: string;
  voice: string;
  qwenVoice: string;
  kokoroVoice: string;
}

export function getTtsProvider(): TtsProvider {
  const normalized = TTS_PROVIDER.trim().toLowerCase();
  return ALLOWED_PROVIDER_NAMES.has(normalized) ? (normalized as TtsProvider) : "qwen";
}

export async function generateCachedSpeech(text: string, options: SpeechOptions = {}): Promise<Buffer> {
  const safeText = text.trim().slice(0, 600);
  if (!safeText) throw new Error("Missing text");

  const target = getCacheTarget({ text: safeText, ...options });
  await mkdir(CACHE_DIR, { recursive: true });

  const cached = await readCachedAudio(target.wavPath);
  if (cached) return cached;

  if (target.provider === "qwen" && QWEN_TTS_API_KEY.trim()) {
    try {
      const audio = await generateQwenSpeech(safeText, target.qwenVoice);
      await writeFile(target.wavPath, audio);
      if (DEBUG_TTS) console.log("[TTS] qwen generated", audio.length, "bytes");
      return audio;
    } catch (error) {
      console.error("[TTS] Qwen-TTS failed, falling back to macOS", error);
    }
  }

  if (target.provider === "kokoro") {
    await generateKokoroSpeech({
      text: safeText,
      voice: target.kokoroVoice,
      outputPath: target.wavPath,
    });
    return readFile(target.wavPath);
  }

  await generateMacSpeech({
    text: safeText,
    voice: target.voice,
    outputPath: target.wavPath,
  });
  return readFile(target.wavPath);
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
      if (seenPaths.has(target.wavPath)) return false;
      seenPaths.add(target.wavPath);
      return true;
    });
  await prewarmSpeechTargets(targets);
}

async function prewarmSpeechTargets(targets: CacheTarget[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });

  const missing: CacheTarget[] = [];
  for (const target of targets) {
    if (await hasCachedAudio(target.wavPath)) continue;
    missing.push(target);
  }

  if (missing.length === 0) return;

  const provider = missing[0].provider;
  if (provider === "kokoro" && missing.every((target) => target.provider === "kokoro")) {
    await generateKokoroSpeechBatch(missing);
    return;
  }

  for (const target of missing) {
    await generateCachedSpeech(target.text, {
      voice: target.voice,
      qwenVoice: target.qwenVoice,
      kokoroVoice: target.kokoroVoice,
    });
  }
}

function getCacheTarget({
  text,
  voice = "Samantha",
  qwenVoice = QWEN_TTS_VOICE,
  kokoroVoice = KOKORO_VOICE,
}: SpeechTarget): CacheTarget {
  const safeText = text.trim().slice(0, 600);
  const provider = getTtsProvider();
  const sanitizedKokoroVoice = sanitizeKokoroVoice(kokoroVoice);
  const cacheVoice =
    provider === "qwen" ? qwenVoice : provider === "kokoro" ? sanitizedKokoroVoice : voice;
  const cacheModel =
    provider === "qwen"
      ? QWEN_TTS_MODEL
      : provider === "kokoro"
        ? `${KOKORO_MODEL}:${KOKORO_LANG}:${Number.isFinite(KOKORO_SPEED) ? KOKORO_SPEED : 1}`
        : "macos-say";
  const hash = createHash("sha256")
    .update(`${provider}:${cacheModel}:${cacheVoice}:${safeText}`)
    .digest("hex")
    .slice(0, 24);

  return {
    text: safeText,
    provider,
    cacheModel,
    cacheVoice,
    wavPath: join(CACHE_DIR, `${hash}.wav`),
    voice,
    qwenVoice,
    kokoroVoice: sanitizedKokoroVoice,
  };
}

async function hasCachedAudio(wavPath: string) {
  try {
    await readFile(wavPath);
    return true;
  } catch {
    return false;
  }
}

async function readCachedAudio(wavPath: string): Promise<Buffer | null> {
  try {
    const audio = await readFile(wavPath);
    if (DEBUG_TTS) console.log("[TTS] cache hit", wavPath);
    return audio;
  } catch {
    return null;
  }
}

function sanitizeKokoroVoice(voice: string): string {
  const normalized = voice.trim();
  return /^[a-z][a-z0-9_]{1,48}$/i.test(normalized) ? normalized : KOKORO_VOICE;
}

async function generateKokoroSpeech({
  text,
  voice,
  outputPath,
}: {
  text: string;
  voice: string;
  outputPath: string;
}): Promise<void> {
  const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}.wav`;

  try {
    await execFileAsync(
      KOKORO_PYTHON,
      [
        KOKORO_SCRIPT,
        "--text",
        text,
        "--voice",
        voice,
        "--lang",
        KOKORO_LANG,
        "--speed",
        Number.isFinite(KOKORO_SPEED) ? String(KOKORO_SPEED) : "1",
        "--output",
        tempPath,
      ],
      getKokoroExecOptions()
    );
    await rename(tempPath, outputPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function generateKokoroSpeechBatch(targets: CacheTarget[]): Promise<void> {
  const tempTargets = targets.map((target, index) => ({
    text: target.text,
    voice: target.kokoroVoice,
    output: `${target.wavPath}.tmp-${process.pid}-${Date.now()}-${index}.wav`,
    finalOutput: target.wavPath,
  }));

  try {
    await execFileAsync(
      KOKORO_PYTHON,
      [
        KOKORO_SCRIPT,
        "--lang",
        KOKORO_LANG,
        "--speed",
        Number.isFinite(KOKORO_SPEED) ? String(KOKORO_SPEED) : "1",
        "--batch-json",
        JSON.stringify(tempTargets.map(({ text, voice, output }) => ({ text, voice, output }))),
      ],
      {
        ...getKokoroExecOptions(),
        timeout: Math.max(Number.isFinite(KOKORO_TIMEOUT_MS) ? KOKORO_TIMEOUT_MS : 30000, targets.length * 30000),
      }
    );

    for (const target of tempTargets) {
      try {
        await rename(target.output, target.finalOutput);
      } catch (error) {
        if (await hasCachedAudio(target.finalOutput)) continue;
        throw error;
      }
    }
  } catch (error) {
    await Promise.all(tempTargets.map((target) => unlink(target.output).catch(() => {})));
    throw error;
  }
}

function getKokoroExecOptions() {
  return {
    timeout: Number.isFinite(KOKORO_TIMEOUT_MS) ? KOKORO_TIMEOUT_MS : 30000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      PYTORCH_ENABLE_MPS_FALLBACK: process.env.PYTORCH_ENABLE_MPS_FALLBACK ?? "1",
    },
  };
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

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
