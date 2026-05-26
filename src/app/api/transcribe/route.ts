import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

    // Pass 1: normal transcription with expected-line prompt.
    let best = await runTranscriptionPass(bytes, fileName, mimeType, prompt);

    // Pass 2 fallback: if empty, retry without prompt (sometimes prompt over-constrains decoding).
    if (!best.text && prompt) {
      console.warn("[Transcribe] empty with prompt; retrying without prompt");
      best = await runTranscriptionPass(bytes, fileName, mimeType, null);
    }

    if (!best.text) {
      // Recoverable case: no transcript from provider. Return 200 so client can
      // show retry UX without surfacing a hard server error.
      return NextResponse.json({ transcript: "", error: "No transcription result" });
    }

    // For line-repetition practice, if the recognized line is already very close,
    // snap to the expected text to remove minor ASR spelling/punctuation noise.
    const shouldSnapToExpected = Boolean(prompt && best.score >= 0.86);
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
