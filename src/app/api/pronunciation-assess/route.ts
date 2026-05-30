import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const TEMP_DIR = join(process.cwd(), ".next", "pronunciation-temp");
const PASS_SCORE = Number(process.env.AZURE_PRONUNCIATION_PASS_SCORE) || 70;
const ASSESSMENT_TIMEOUT_MS =
  Number(process.env.AZURE_PRONUNCIATION_TIMEOUT_MS) || 12_000;
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY ?? "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION ?? "";

interface WordAssessment {
  word: string;
  accuracyScore?: number;
  errorType?: string;
}

export async function POST(request: Request) {
  if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
    return NextResponse.json(
      { error: "AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is not configured" },
      { status: 500 }
    );
  }

  let inputPath: string | null = null;
  let wavPath: string | null = null;

  try {
    const formData = await request.formData();
    const audio = formData.get("audio") as File | null;
    const referenceText = normalizeReferenceText(String(formData.get("referenceText") ?? ""));

    if (!audio || audio.size === 0) {
      return NextResponse.json({ error: "No audio provided" }, { status: 400 });
    }

    if (!referenceText) {
      return NextResponse.json({ error: "Missing referenceText" }, { status: 400 });
    }

    await mkdir(TEMP_DIR, { recursive: true });
    const id = randomUUID();
    inputPath = join(TEMP_DIR, `${id}.webm`);
    wavPath = join(TEMP_DIR, `${id}.wav`);
    await writeFile(inputPath, Buffer.from(await audio.arrayBuffer()));

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

    const wav = await readFile(wavPath);
    const result = await withTimeout(
      assessPronunciation(wav, referenceText),
      ASSESSMENT_TIMEOUT_MS
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Pronunciation] assessment failed", error);
    return NextResponse.json({ error: "Pronunciation assessment failed" }, { status: 500 });
  } finally {
    if (inputPath) await unlink(inputPath).catch(() => {});
    if (wavPath) await unlink(wavPath).catch(() => {});
  }
}

function normalizeReferenceText(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, ", ")
    .replace(/[^\w\s'.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSpokenWords(text: string): boolean {
  return /[a-z0-9]/i.test(text);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Pronunciation assessment timeout")), timeoutMs);
    }),
  ]);
}

async function assessPronunciation(wav: Buffer, referenceText: string) {
  const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
  speechConfig.speechRecognitionLanguage = "en-US";
  speechConfig.outputFormat = sdk.OutputFormat.Detailed;

  const audioConfig = sdk.AudioConfig.fromWavFileInput(wav, "speech.wav");
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
    referenceText,
    sdk.PronunciationAssessmentGradingSystem.HundredMark,
    sdk.PronunciationAssessmentGranularity.Phoneme,
    true
  );
  pronunciationConfig.phonemeAlphabet = "IPA";
  pronunciationConfig.applyTo(recognizer);

  try {
    const recognition = await recognizeOnce(recognizer);
    if (recognition.reason !== sdk.ResultReason.RecognizedSpeech) {
      const cancellation = sdk.CancellationDetails.fromResult(recognition);
      throw new Error(cancellation.errorDetails || `Recognition failed: ${recognition.reason}`);
    }

    if (!hasSpokenWords(recognition.text)) {
      return {
        transcript: "",
        referenceText,
        pass: false,
        pronunciationScore: 0,
        accuracyScore: 0,
        fluencyScore: 0,
        completenessScore: 0,
        words: [],
        error: "No recognizable speech",
      };
    }

    const pronunciation = sdk.PronunciationAssessmentResult.fromResult(recognition);
    const words = pronunciation.detailResult?.Words?.map((word): WordAssessment => ({
      word: word.Word,
      accuracyScore: word.PronunciationAssessment?.AccuracyScore,
      errorType: word.PronunciationAssessment?.ErrorType,
    })) ?? [];

    return {
      transcript: recognition.text,
      referenceText,
      pass: pronunciation.pronunciationScore >= PASS_SCORE,
      pronunciationScore: Math.round(pronunciation.pronunciationScore),
      accuracyScore: Math.round(pronunciation.accuracyScore),
      fluencyScore: Math.round(pronunciation.fluencyScore),
      completenessScore: Math.round(pronunciation.completenessScore),
      words,
    };
  } finally {
    recognizer.close();
    audioConfig.close();
  }
}

function recognizeOnce(recognizer: sdk.SpeechRecognizer): Promise<sdk.SpeechRecognitionResult> {
  return new Promise((resolve, reject) => {
    recognizer.recognizeOnceAsync(resolve, reject);
  });
}
