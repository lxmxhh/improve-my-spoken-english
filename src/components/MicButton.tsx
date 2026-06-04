"use client";

import { useEffect, useRef, useState } from "react";
import type { CapturedAudio, PracticeMode, PronunciationAssessment } from "@/lib/types";

// Re-export for consumers that import from this module
export type { PronunciationAssessment } from "@/lib/types";

interface MicButtonProps {
  onResult: (
    transcript: string,
    assessment?: PronunciationAssessment,
    audio?: CapturedAudio
  ) => void | Promise<void>;
  onNoSpeech: () => void;
  disabled: boolean;
  mode?: PracticeMode;
  referenceText?: string;
  variant?: "default" | "compact";
}

type MicState = "idle" | "listening" | "processing";
type CaptureMode = "worklet" | "media-recorder";
type WindowWithWebKitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const AUTO_STOP_MS = 10_000;
const MIN_RECORDING_MS = 800;
const MIN_AUDIO_BYTES = 2_000;
const MIN_AUTO_STOP_MS = 10_000;
const MAX_AUTO_STOP_MS = 25_000;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function estimateRecordingLimitMs(referenceText?: string) {
  const words = referenceText?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  if (words === 0) return AUTO_STOP_MS;
  return clamp(Math.ceil(words * 700 + 3_000), MIN_AUTO_STOP_MS, MAX_AUTO_STOP_MS);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function countSamples(samples: Float32Array[]) {
  return samples.reduce((total, chunk) => total + chunk.length, 0);
}

function inferSampleRate(samples: Float32Array[], durationMs: number, fallbackSampleRate: number) {
  const sampleCount = countSamples(samples);
  if (sampleCount <= 0 || durationMs <= 0) return fallbackSampleRate;

  const inferred = sampleCount / (durationMs / 1000);
  const commonRates = [16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000];
  const nearest = commonRates.reduce((best, rate) => (
    Math.abs(rate - inferred) < Math.abs(best - inferred) ? rate : best
  ), commonRates[0]);

  if (Math.abs(nearest - inferred) / nearest < 0.08) return nearest;
  return Math.round(inferred);
}

function encodeWav(samples: Float32Array[], sampleRate: number) {
  const sampleCount = countSamples(samples);
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

function getAudioContextConstructor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WindowWithWebKitAudio).webkitAudioContext ?? null;
}

function getBestMediaRecorderMimeType() {
  if (typeof window === "undefined" || !("MediaRecorder" in window)) return "";

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/aac",
  ];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function getAudioFileName(mimeType: string) {
  if (mimeType.includes("wav")) return "speech.wav";
  if (mimeType.includes("mp4")) return "speech.m4a";
  if (mimeType.includes("aac")) return "speech.aac";
  if (mimeType.includes("ogg")) return "speech.ogg";
  return "speech.webm";
}

async function getMicrophoneStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia unavailable");
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError") {
      throw error;
    }
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

export default function MicButton({
  onResult,
  onNoSpeech,
  disabled,
  mode = "practice",
  referenceText,
  variant = "default",
}: MicButtonProps) {
  const [micState, setMicState] = useState<MicState>("idle");
  const [countdown, setCountdown] = useState(AUTO_STOP_MS / 1000);
  const [recordingLimitSec, setRecordingLimitSec] = useState(AUTO_STOP_MS / 1000);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stateRef = useRef<MicState>("idle");
  const activeModeRef = useRef<CaptureMode>("worklet");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const samplesRef = useRef<Float32Array[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingLimitMsRef = useRef(AUTO_STOP_MS);

  function setState(s: MicState) {
    stateRef.current = s;
    setMicState(s);
  }

  function clearTimers() {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    autoStopRef.current = null;
    countdownRef.current = null;
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

  async function sendAudio(blob: Blob, fileName: string, durationMs: number) {
    setState("processing");
    const capturedAudio: CapturedAudio = {
      blob,
      mimeType: blob.type || "application/octet-stream",
      durationMs,
    };

    try {
      if (blob.size < MIN_AUDIO_BYTES) {
        setState("idle");
        setErrorMsg("No usable audio captured — please try again.");
        onNoSpeech();
        return;
      }

      if (mode === "assessment" && referenceText) {
        // Assessment mode: call pronunciation-assess for strict scoring
        const form = new FormData();
        form.append("audio", blob, fileName);
        form.append("referenceText", referenceText);
        const res = await fetch("/api/pronunciation-assess", { method: "POST", body: form });
        const data = await res.json() as PronunciationAssessment & { error?: string };

        if (!res.ok || data.error) {
          setState("idle");
          setErrorMsg("Could not assess pronunciation. Please try again.");
          onNoSpeech();
          return;
        }

        await onResult(data.transcript ?? "", data, capturedAudio);
        setState("idle");
      } else {
        // Practice mode: transcribe without snap-to-expected bias
        const form = new FormData();
        form.append("audio", blob, fileName);
        form.append("mode", "practice");
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = await res.json() as { transcript?: string; error?: string };

        if (!res.ok || !data.transcript?.trim()) {
          setState("idle");
          setErrorMsg("Could not transcribe this attempt. Try speaking a full sentence a bit slower and closer to the mic.");
          onNoSpeech();
          return;
        }

        await onResult(data.transcript.trim(), undefined, capturedAudio);
        setState("idle");
      }
    } catch (err) {
      console.error("[STT] transcribe error:", err);
      setState("idle");
      setErrorMsg("Transcription failed — please try again.");
      onNoSpeech();
    }
  }

  async function finalizeWorkletRecording() {
    clearTimers();
    const durationMs = Date.now() - recordingStartedAtRef.current;
    const contextSampleRate = audioContextRef.current?.sampleRate ?? 48_000;
    const sampleRate = inferSampleRate(samplesRef.current, durationMs, contextSampleRate);

    stopWorkletGraph();
    stopStream();

    const blob = encodeWav(samplesRef.current, sampleRate);
    await sendAudio(blob, "speech.wav", durationMs);
  }

  async function finalizeMediaRecorderRecording() {
    clearTimers();
    stopStream();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const type = mediaRecorderRef.current?.mimeType || chunksRef.current[0]?.type || "audio/webm";
    const blob = new Blob(chunksRef.current, { type });
    const durationMs = Date.now() - recordingStartedAtRef.current;
    await sendAudio(blob, getAudioFileName(type), durationMs);
  }

  async function startWorkletRecording(stream: MediaStream) {
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor || !("AudioWorkletNode" in window)) {
      throw new Error("AudioWorklet is unavailable");
    }

    const audioContext = new AudioContextCtor();
    if (!audioContext.audioWorklet) {
      throw new Error("audioWorklet is unavailable");
    }

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
    if (!("MediaRecorder" in window)) {
      throw new Error("MediaRecorder is unavailable");
    }

    const mimeType = getBestMediaRecorderMimeType();
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

  async function stopRecording() {
    const elapsed = Date.now() - recordingStartedAtRef.current;
    if (elapsed < MIN_RECORDING_MS) return;

    if (activeModeRef.current === "worklet") {
      await finalizeWorkletRecording();
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.requestData();
    recorder.stop();
  }

  async function toggleListening() {
    setErrorMsg(null);
    if (disabled) return;

    if (stateRef.current === "listening") {
      await stopRecording();
      return;
    }

    if (stateRef.current !== "idle") return;

    try {
      const stream = await getMicrophoneStream();
      streamRef.current = stream;

      try {
        await startWorkletRecording(stream);
      } catch (workletError) {
        console.warn("[STT] AudioWorklet unavailable, falling back to MediaRecorder:", workletError);
        stopWorkletGraph();
        startMediaRecorderRecording(stream);
      }

      recordingStartedAtRef.current = Date.now();
      const recordingLimitMs = estimateRecordingLimitMs(referenceText);
      recordingLimitMsRef.current = recordingLimitMs;
      setRecordingLimitSec(Math.ceil(recordingLimitMs / 1000));
      setState("listening");
      setCountdown(Math.ceil(recordingLimitMs / 1000));

      autoStopRef.current = setTimeout(() => {
        if (stateRef.current === "listening") {
          void stopRecording();
        }
      }, recordingLimitMs);

      countdownRef.current = setInterval(() => {
        setCountdown((current) => Math.max(0, current - 1));
      }, 1000);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      console.error("[STT] getUserMedia failed:", err);
      stopWorkletGraph();
      stopStream();
      if (name === "NotAllowedError") {
        setErrorMsg("Microphone permission denied. Please allow access and try again.");
      } else if (name === "Error" || name === "NotFoundError" || name === "NotReadableError") {
        setErrorMsg("Microphone is unavailable. Check browser permission and device settings.");
      } else {
        setErrorMsg(`Microphone error: ${name || "unknown"}`);
      }
    }
  }

  useEffect(() => {
    if (!disabled && stateRef.current === "processing") {
      setState("idle");
      setCountdown(Math.ceil(recordingLimitMsRef.current / 1000));
      setRecordingLimitSec(Math.ceil(recordingLimitMsRef.current / 1000));
    }
  }, [disabled]);

  useEffect(() => () => {
    clearTimers();
    stopWorkletGraph();
    stopStream();
  }, []);

  const isListening = micState === "listening";
  const isProcessing = micState === "processing";
  const isCompact = variant === "compact";

  return (
    <div className={`flex flex-col items-center gap-2 ${isCompact ? "w-full" : ""}`}>
      {errorMsg && (
        <p className="text-xs text-red-500 text-center max-w-xs">{errorMsg}</p>
      )}
      <button
        onClick={toggleListening}
        disabled={disabled || isProcessing}
        aria-label={isListening ? "Stop recording" : "Start recording"}
        className={`relative ${isCompact ? "w-12 h-12" : "w-20 h-20"} rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400 select-none touch-none ${
          isListening
            ? "bg-red-500 text-white shadow-lg scale-110 ring-4 ring-red-300 ring-opacity-60"
            : isProcessing
            ? "bg-gray-400 text-white cursor-not-allowed"
            : disabled
            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg"
        }`}
      >
        {isProcessing ? (
          <svg className={`${isCompact ? "w-5 h-5" : "w-8 h-8"} animate-spin`} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        ) : (
          <svg className={isCompact ? "w-5 h-5" : "w-8 h-8"} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 1a4 4 0 00-4 4v7a4 4 0 008 0V5a4 4 0 00-4-4zm-1 18.93A8.001 8.001 0 014 12H2a10 10 0 0010 10v-2.07zm2 0V22a10 10 0 0010-10h-2a8.001 8.001 0 01-7 7.93z" />
          </svg>
        )}
        {isListening && (
          <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-40" />
        )}
      </button>

      {isListening && (
        <div className={`${isCompact ? "w-24" : "w-32"} flex flex-col items-center gap-1`}>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-red-500 h-1.5 rounded-full transition-all duration-1000"
              style={{ width: `${(countdown / recordingLimitSec) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{countdown}s remaining</span>
        </div>
      )}

      <p className="text-xs text-gray-400">
        {isListening ? "Listening… click to stop" : isProcessing ? (mode === "assessment" ? "Assessing…" : "Transcribing…") : "Click to speak"}
      </p>
    </div>
  );
}
