import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const TEMP_DIR = join(process.cwd(), ".next", "transcribe-temp");
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY ?? "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION ?? "";
const AZURE_TRANSCRIBE_TIMEOUT_MS =
  Number(process.env.AZURE_TRANSCRIBE_TIMEOUT_MS) || 30_000;

const groq = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY ?? "",
});

const MODELS = ["whisper-large-v3", "whisper-large-v3-turbo"] as const;

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOverlap(a: string, b: string): number {
  const setA = new Set(normalizeText(a).split(" ").filter(Boolean));
  const setB = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? inter / union : 0;
}

function levenshtein(a: string, b: string): number {
  const aa = normalizeText(a);
  const bb = normalizeText(b);
  const m = aa.length;
  const n = bb.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function charSimilarity(a: string, b: string): number {
  const aa = normalizeText(a);
  const bb = normalizeText(b);
  const maxLen = Math.max(aa.length, bb.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(aa, bb);
  return Math.max(0, 1 - dist / maxLen);
}

function scoreCandidate(text: string, expected?: string): number {
  const t = text.trim();
  if (!t) return -1;
  if (!expected) return Math.min(1, t.length / 40);
  const w = wordOverlap(t, expected);
  const c = charSimilarity(t, expected);
  return 0.45 * w + 0.55 * c;
}

function shouldUseExpectedTranscript(candidate: string, expected: string): boolean {
  const w = wordOverlap(candidate, expected);
  const c = charSimilarity(candidate, expected);
  const normalizedCandidate = normalizeText(candidate);
  const normalizedExpected = normalizeText(expected);

  if (!normalizedCandidate || !normalizedExpected) return false;

  const expectedWords = normalizedExpected.split(" ").filter(Boolean);
  const candidateWords = normalizedCandidate.split(" ").filter(Boolean);
  const lengthRatio = candidateWords.length / Math.max(1, expectedWords.length);

  return (
    c >= 0.78 ||
    (w >= 0.55 && lengthRatio >= 0.45) ||
    (w >= 0.42 && c >= 0.58 && lengthRatio >= 0.45)
  );
}

function isLikelyHallucinatedTranscript(candidate: string, expected?: string): boolean {
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCandidate) return true;

  const genericShortOutputs = new Set([
    "thank you",
    "thanks",
    "thank you very much",
    "thanks for watching",
    "thank you for watching",
    "bye",
    "goodbye",
  ]);

  if (!expected) return genericShortOutputs.has(normalizedCandidate);

  const normalizedExpected = normalizeText(expected);
  const candidateWords = normalizedCandidate.split(" ").filter(Boolean);
  const expectedWords = normalizedExpected.split(" ").filter(Boolean);
  const w = wordOverlap(candidate, expected);
  const c = charSimilarity(candidate, expected);
  const lengthRatio = candidateWords.length / Math.max(1, expectedWords.length);

  return (
    genericShortOutputs.has(normalizedCandidate) ||
    (expectedWords.length >= 8 && candidateWords.length <= 2 && w < 0.2) ||
    (expectedWords.length >= 10 && lengthRatio < 0.25 && w < 0.25 && c < 0.45)
  );
}

function hasSpokenWords(text: string): boolean {
  return /[a-z0-9]/i.test(text);
}

async function convertToWav(bytes: ArrayBuffer, extension = "webm"): Promise<Buffer> {
  await mkdir(TEMP_DIR, { recursive: true });
  const id = randomUUID();
  const inputPath = join(TEMP_DIR, `${id}.input.${extension}`);
  const wavPath = join(TEMP_DIR, `${id}.output.wav`);

  try {
    await writeFile(inputPath, Buffer.from(bytes));
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      wavPath,
    ]);
    return await readFile(wavPath);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(wavPath).catch(() => {});
  }
}

async function transcribeWithAzure(bytes: ArrayBuffer, mimeType: string): Promise<string> {
  if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) return "";

  const extension = mimeType.includes("wav") ? "wav" : "webm";
  const wav = await convertToWav(bytes, extension);
  const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
  speechConfig.speechRecognitionLanguage = "en-US";
  speechConfig.outputFormat = sdk.OutputFormat.Detailed;

  const audioConfig = sdk.AudioConfig.fromWavFileInput(wav, "speech.wav");
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  try {
    const segments = await withTimeout(
      recognizeContinuously(recognizer),
      AZURE_TRANSCRIBE_TIMEOUT_MS
    );
    return segments.join(" ").replace(/\s+/g, " ").trim();
  } finally {
    recognizer.close();
    audioConfig.close();
  }
}

function recognizeContinuously(recognizer: sdk.SpeechRecognizer): Promise<string[]> {
  const segments: string[] = [];

  return new Promise((resolve, reject) => {
    recognizer.recognized = (_, event) => {
      if (event.result.reason === sdk.ResultReason.RecognizedSpeech) {
        const text = event.result.text.trim();
        if (text) segments.push(text);
      }
    };

    recognizer.canceled = (_, event) => {
      if (event.reason === sdk.CancellationReason.EndOfStream) {
        resolve(segments);
        return;
      }
      reject(new Error(event.errorDetails || `Azure recognition canceled: ${event.reason}`));
    };

    recognizer.sessionStopped = () => {
      resolve(segments);
    };

    recognizer.startContinuousRecognitionAsync(
      undefined,
      (error) => reject(error)
    );
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Azure transcription timeout")), timeoutMs);
    }),
  ]);
}

async function transcribeWithModel(audio: File, prompt: string | null, model: (typeof MODELS)[number]) {
  const transcription = await groq.audio.transcriptions.create({
    file: audio,
    model,
    language: "en",
    ...(prompt ? { prompt } : {}),
  });
  return (transcription.text ?? "").trim();
}

async function runTranscriptionPass(
  bytes: ArrayBuffer,
  fileName: string,
  mimeType: string,
  prompt: string | null
) {
  const results = await Promise.allSettled(
    MODELS.map((model) => {
      const modelFile = new File([bytes], fileName, { type: mimeType });
      return transcribeWithModel(modelFile, prompt, model);
    })
  );

  const candidates = results.map((r, i) => {
    const model = MODELS[i];
    if (r.status === "fulfilled") {
      return { model, text: r.value, score: scoreCandidate(r.value, prompt ?? undefined) };
    }
    console.warn(`[Transcribe] ${model} failed`, r.reason);
    return { model, text: "", score: -1 };
  });

  return candidates.reduce((acc, cur) => (cur.score > acc.score ? cur : acc), candidates[0]);
}

export async function POST(request: Request) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const audio = formData.get("audio") as File | null;
    const prompt = formData.get("prompt") as string | null;

    if (!audio || audio.size === 0) {
      return NextResponse.json({ error: "No audio provided" }, { status: 400 });
    }

    const bytes = await audio.arrayBuffer();
    const fileName = audio.name || "speech.webm";
    const mimeType = audio.type || "audio/webm";

    console.log("[Transcribe] audio size:", audio.size, "type:", mimeType, "prompt:", prompt?.slice(0, 60));

    if (!prompt) {
      try {
        const azureTranscript = await transcribeWithAzure(bytes, mimeType);
        if (hasSpokenWords(azureTranscript)) {
          console.log("[Transcribe] selected: azure text:", azureTranscript);
          return NextResponse.json({
            transcript: azureTranscript,
            rawTranscript: azureTranscript,
            selectedModel: "azure-speech-continuous",
            score: null,
          });
        }
      } catch (error) {
        console.warn("[Transcribe] Azure STT failed; falling back to Groq", error);
      }
    }

    let best = await runTranscriptionPass(bytes, fileName, mimeType, prompt);

    if (prompt) {
      // Retry without prompt if the prompted decode is empty or looks like a
      // common Whisper hallucination such as "Thank you".
      if (!best.text || isLikelyHallucinatedTranscript(best.text, prompt)) {
        console.warn("[Transcribe] weak prompted transcript; retrying without prompt:", best.text);
        const unprompted = await runTranscriptionPass(bytes, fileName, mimeType, null);
        if (unprompted.text && !isLikelyHallucinatedTranscript(unprompted.text, prompt)) {
          best = unprompted;
        }
      }

      if (!best.text || isLikelyHallucinatedTranscript(best.text, prompt)) {
        console.warn("[Transcribe] rejected low-confidence transcript:", best.text);
        return NextResponse.json({
          transcript: "",
          rawTranscript: best.text,
          error: "Low-confidence transcription",
        });
      }
    } else if (!best.text) {
      // Recoverable case: no transcript from provider. Return 200 so client can
      // show retry UX without surfacing a hard server error.
      console.warn("[Transcribe] empty transcript");
      return NextResponse.json({
        transcript: "",
        rawTranscript: best.text,
        error: "No transcription result",
      });
    }

    // For line-repetition practice, if recognition is plausibly close to the
    // displayed prompt, prefer the expected text. This reduces frustrating ASR
    // drift on short learner utterances while still preserving clearly different
    // speech for evaluation.
    const shouldSnapToExpected = Boolean(prompt && shouldUseExpectedTranscript(best.text, prompt));
    const transcript = shouldSnapToExpected ? (prompt as string) : best.text;

    console.log("[Transcribe] selected:", best.model, "score:", best.score.toFixed(3), "text:", transcript);
    return NextResponse.json({
      transcript,
      rawTranscript: best.text,
      selectedModel: best.model,
      score: Number(best.score.toFixed(4)),
    });
  } catch (error) {
    console.error("[Transcribe] error:", error);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
