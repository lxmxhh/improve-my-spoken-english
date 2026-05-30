"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type RecordingState = "idle" | "recording" | "transcribing";
type RecordingMode = "worklet" | "media-recorder";

interface TranscribeResponse {
  transcript?: string;
  rawTranscript?: string;
  selectedModel?: string;
  score?: number | null;
  error?: string;
}

interface AudioInfo {
  size: number;
  type: string;
  durationMs: number;
  chunks: number;
  sampleRate?: number;
  contextSampleRate?: number;
  sampleCount?: number;
  mode: RecordingMode;
}

const MIN_RECORDING_MS = 800;
const MIN_AUDIO_BYTES = 2_000;

function encodeWav(samples: Float32Array[], sampleRate: number) {
  const sampleCount = samples.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of samples) {
    for (const sample of chunk) {
      const value = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function countSamples(samples: Float32Array[]) {
  return samples.reduce((total, chunk) => total + chunk.length, 0);
}

function inferSampleRate(samples: Float32Array[], durationMs: number, fallbackSampleRate: number) {
  const sampleCount = countSamples(samples);
  if (sampleCount <= 0 || durationMs <= 0) return fallbackSampleRate;

  const inferred = sampleCount / (durationMs / 1000);
  const commonRates = [16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000];
  const nearest = commonRates.reduce((best, rate) => {
    return Math.abs(rate - inferred) < Math.abs(best - inferred) ? rate : best;
  }, commonRates[0]);

  if (Math.abs(nearest - inferred) / nearest < 0.08) return nearest;
  return Math.round(inferred);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function SttTestPage() {
  const [state, setState] = useState<RecordingState>("idle");
  const [mode, setMode] = useState<RecordingMode>("worklet");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [expectedText, setExpectedText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [result, setResult] = useState<TranscribeResponse | null>(null);

  const samplesRef = useRef<Float32Array[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeModeRef = useRef<RecordingMode>("worklet");
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function stopWorkletGraph() {
    workletNodeRef.current?.disconnect();
    mediaSourceRef.current?.disconnect();
    workletNodeRef.current = null;
    mediaSourceRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
  }

  function replaceAudioUrl(url: string | null) {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = url;
    setAudioUrl(url);
  }

  function revokeAudioUrl() {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }

  function startElapsedTimer() {
    clearTimer();
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 100);
  }

  async function transcribe(blob: Blob, fileName: string) {
    setState("transcribing");
    setErrorMsg(null);

    try {
      const form = new FormData();
      form.append("audio", blob, fileName);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as TranscribeResponse;
      setResult(data);

      if (!response.ok || !data.transcript?.trim()) {
        setErrorMsg(data.error ?? "No transcript returned.");
      }
    } catch (error) {
      console.error("[STT Test] transcribe failed:", error);
      setErrorMsg("Transcription request failed.");
      setResult(null);
    } finally {
      setState("idle");
    }
  }

  async function finalizeWorkletRecording() {
    clearTimer();
    const durationMs = Date.now() - startedAtRef.current;
    const contextSampleRate = audioContextRef.current?.sampleRate ?? 48_000;
    const sampleRate = inferSampleRate(samplesRef.current, durationMs, contextSampleRate);
    const sampleCount = countSamples(samplesRef.current);

    stopWorkletGraph();
    stopStream();
    setElapsedMs(durationMs);

    const blob = encodeWav(samplesRef.current, sampleRate);
    const info: AudioInfo = {
      size: blob.size,
      type: blob.type,
      durationMs,
      chunks: samplesRef.current.length,
      sampleRate,
      contextSampleRate,
      sampleCount,
      mode: "worklet",
    };
    setAudioInfo(info);

    if (blob.size < MIN_AUDIO_BYTES) {
      setState("idle");
      setErrorMsg("No usable audio captured. Record a full sentence and try again.");
      setResult(null);
      replaceAudioUrl(null);
      return;
    }

    replaceAudioUrl(URL.createObjectURL(blob));
    await transcribe(blob, "speech.wav");
  }

  async function finalizeMediaRecorderRecording() {
    clearTimer();
    stopStream();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const durationMs = Date.now() - startedAtRef.current;
    const blob = new Blob(chunksRef.current, {
      type: mediaRecorderRef.current?.mimeType || "audio/webm",
    });
    setElapsedMs(durationMs);
    setAudioInfo({
      size: blob.size,
      type: blob.type || "unknown",
      durationMs,
      chunks: chunksRef.current.length,
      mode: "media-recorder",
    });

    if (blob.size < MIN_AUDIO_BYTES) {
      setState("idle");
      setErrorMsg("No usable audio captured. Record a full sentence and try again.");
      setResult(null);
      replaceAudioUrl(null);
      return;
    }

    replaceAudioUrl(URL.createObjectURL(blob));
    await transcribe(blob, "speech.webm");
  }

  async function startWorkletRecording(stream: MediaStream) {
    const audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    await audioContext.audioWorklet.addModule("/audio-recorder-worklet.js");
    const source = audioContext.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(audioContext, "audio-recorder-processor");
    samplesRef.current = [];

    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      samplesRef.current.push(event.data);
    };

    source.connect(node);
    node.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    mediaSourceRef.current = source;
    workletNodeRef.current = node;
    activeModeRef.current = "worklet";
  }

  function startMediaRecorderRecording(stream: MediaStream) {
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      void finalizeMediaRecorderRecording();
    };

    recorder.start(250);
    activeModeRef.current = "media-recorder";
  }

  async function startRecording() {
    if (state !== "idle") return;

    setErrorMsg(null);
    setResult(null);
    setAudioInfo(null);
    replaceAudioUrl(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      if (mode === "worklet") {
        try {
          await startWorkletRecording(stream);
        } catch (workletError) {
          console.warn("[STT Test] AudioWorklet unavailable, falling back to MediaRecorder:", workletError);
          stopWorkletGraph();
          startMediaRecorderRecording(stream);
        }
      } else {
        startMediaRecorderRecording(stream);
      }

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setState("recording");
      startElapsedTimer();
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      console.error("[STT Test] getUserMedia failed:", error);
      setErrorMsg(name === "NotAllowedError" ? "Microphone permission denied." : `Microphone error: ${name}`);
      stopWorkletGraph();
      stopStream();
      setState("idle");
    }
  }

  function stopRecording() {
    const durationMs = Date.now() - startedAtRef.current;
    if (state !== "recording") return;
    if (durationMs < MIN_RECORDING_MS) {
      setErrorMsg("Keep recording for at least 0.8 seconds.");
      return;
    }

    setErrorMsg(null);

    if (activeModeRef.current === "worklet") {
      void finalizeWorkletRecording();
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.requestData();
    recorder.stop();
  }

  useEffect(() => {
    return () => {
      clearTimer();
      stopWorkletGraph();
      stopStream();
      revokeAudioUrl();
    };
  }, []);

  const isRecording = state === "recording";
  const isTranscribing = state === "transcribing";

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-600">Speech recognition lab</p>
            <h1 className="mt-1 text-3xl font-bold">STT Test</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-gray-600">
              Record one sentence, replay the captured audio, and inspect the raw transcription result. The expected text below is only for your visual comparison and is not sent as a prompt.
            </p>
          </div>
          <Link href="/" className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
            Back home
          </Link>
        </header>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <label htmlFor="expected-text" className="text-sm font-semibold text-gray-700">
            Expected text for comparison
          </label>
          <textarea
            id="expected-text"
            value={expectedText}
            onChange={(event) => setExpectedText(event.target.value)}
            rows={3}
            placeholder="Optional: paste the sentence you intended to say."
            className="mt-2 w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-700">Recorder</p>
              <p className="mt-1 text-sm text-gray-500">
                {isRecording
                  ? "Recording. Click stop when you finish speaking."
                  : isTranscribing
                  ? "Uploading and transcribing."
                  : "Ready to capture your next attempt."}
              </p>
            </div>
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isTranscribing}
              className={`h-12 min-w-36 rounded-md px-5 text-sm font-semibold text-white transition ${
                isRecording
                  ? "bg-red-600 hover:bg-red-700"
                  : isTranscribing
                  ? "cursor-not-allowed bg-gray-400"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {isRecording ? "Stop" : isTranscribing ? "Transcribing..." : "Start recording"}
            </button>
          </div>

          <div className="mt-5 flex rounded-md border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              disabled={state !== "idle"}
              onClick={() => setMode("worklet")}
              className={`flex-1 rounded px-3 py-2 text-sm font-semibold transition ${
                mode === "worklet" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Stable PCM
            </button>
            <button
              type="button"
              disabled={state !== "idle"}
              onClick={() => setMode("media-recorder")}
              className={`flex-1 rounded px-3 py-2 text-sm font-semibold transition ${
                mode === "media-recorder" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              MediaRecorder
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase text-gray-400">Elapsed</p>
              <p className="mt-1 text-lg font-semibold">{formatSeconds(elapsedMs)}</p>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase text-gray-400">Audio size</p>
              <p className="mt-1 text-lg font-semibold">{audioInfo ? formatBytes(audioInfo.size) : "-"}</p>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase text-gray-400">Format</p>
              <p className="mt-1 break-words text-sm font-semibold">
                {audioInfo?.type ?? "-"}
                {audioInfo ? ` · ${audioInfo.chunks} chunks` : ""}
                {audioInfo?.sampleRate ? ` · ${audioInfo.sampleRate} Hz` : ""}
                {audioInfo?.contextSampleRate && audioInfo.contextSampleRate !== audioInfo.sampleRate
                  ? ` · ctx ${audioInfo.contextSampleRate} Hz`
                  : ""}
              </p>
            </div>
          </div>

          {errorMsg && (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMsg}
            </p>
          )}

          {audioUrl && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold text-gray-700">Captured audio</p>
              <audio controls src={audioUrl} className="w-full" />
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-gray-700">Transcript</p>
            <p className="min-h-16 rounded-md bg-gray-50 p-3 text-base leading-7">
              {result?.transcript?.trim() || "No transcript yet."}
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase text-gray-400">Provider</p>
              <p className="mt-1 break-words text-sm font-semibold">{result?.selectedModel ?? "-"}</p>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase text-gray-400">Mode</p>
              <p className="mt-1 text-sm font-semibold">{audioInfo?.mode ?? "-"}</p>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase text-gray-400">Raw text</p>
              <p className="mt-1 break-words text-sm font-semibold">{result?.rawTranscript ?? "-"}</p>
            </div>
          </div>

          <details className="mt-5">
            <summary className="cursor-pointer text-sm font-semibold text-gray-700">Raw JSON response</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-gray-950 p-3 text-xs leading-5 text-gray-100">
              {result ? JSON.stringify(result, null, 2) : "{}"}
            </pre>
          </details>
        </section>
      </div>
    </main>
  );
}
