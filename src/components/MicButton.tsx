"use client";

import { useEffect, useRef, useState } from "react";

interface MicButtonProps {
  onResult: (transcript: string) => void;
  onNoSpeech: () => void;
  disabled: boolean;
  /** Expected line passed as transcription context to improve accuracy. */
  prompt?: string;
}

type MicState = "idle" | "listening" | "processing";

const AUTO_STOP_MS = 10_000; // auto-stop after 10s silence (no manual stop)

export default function MicButton({ onResult, onNoSpeech, disabled, prompt }: MicButtonProps) {
  const [micState, setMicState] = useState<MicState>("idle");
  const [countdown, setCountdown] = useState(AUTO_STOP_MS / 1000);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stateRef = useRef<MicState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function setState(s: MicState) {
    stateRef.current = s;
    setMicState(s);
  }

  function clearTimers() {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function stopRecorder() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.stop();
  }

  async function sendAudio(chunks: Blob[], mimeType: string) {
    setState("processing");
    try {
      const blob = new Blob(chunks, { type: mimeType });
      console.log("[STT] sending audio, size:", blob.size, "type:", mimeType);
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      if (prompt) form.append("prompt", prompt);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json() as { transcript?: string; error?: string };
      if (!res.ok || !data.transcript?.trim()) {
        console.warn("[STT] no transcript:", data);
        setState("idle");
        setErrorMsg("Could not transcribe this attempt. Try speaking a full sentence a bit slower and closer to the mic.");
        onNoSpeech();
      } else {
        console.log("[STT] transcript:", data.transcript);
        setState("processing");
        onResult(data.transcript.trim());
      }
    } catch (err) {
      console.error("[STT] transcribe error:", err);
      setState("idle");
      setErrorMsg("Transcription failed — please try again.");
      onNoSpeech();
    }
  }

  async function toggleListening() {
    setErrorMsg(null);
    if (disabled) return;

    // Second click: stop recording
    if (stateRef.current === "listening") {
      clearTimers();
      stopRecorder(); // triggers onstop → sendAudio
      return;
    }

    if (stateRef.current !== "idle") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stopStream();
        setTimeout(() => {
          const chunks = chunksRef.current;
          const type = recorder.mimeType || "audio/webm";
          const totalBytes = chunks.reduce((s, b) => s + b.size, 0);
          console.log("[STT] recorded chunks:", chunks.length, "bytes:", totalBytes);
          if (totalBytes === 0) {
            setState("idle");
            setErrorMsg("No audio captured — please try again.");
            onNoSpeech();
            return;
          }
          void sendAudio(chunks, type);
        }, 50);
      };

      recorder.start();
      setState("listening");
      setCountdown(AUTO_STOP_MS / 1000);

      // Auto-stop after AUTO_STOP_MS
      autoStopRef.current = setTimeout(() => {
        if (stateRef.current === "listening") {
          clearTimers();
          stopRecorder();
        }
      }, AUTO_STOP_MS);

      // Countdown
      countdownRef.current = setInterval(() => {
        setCountdown((c) => Math.max(0, c - 1));
      }, 1000);

    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      console.error("[STT] getUserMedia failed:", err);
      if (name === "NotAllowedError") {
        setErrorMsg("Microphone permission denied. Please allow access and try again.");
      } else {
        setErrorMsg(`Microphone error: ${name || "unknown"}`);
      }
    }
  }

  useEffect(() => {
    if (!disabled && stateRef.current === "processing") {
      setState("idle");
      setCountdown(AUTO_STOP_MS / 1000);
    }
  }, [disabled]);

  useEffect(() => () => {
    clearTimers();
    stopStream();
  }, []);

  const isListening = micState === "listening";
  const isProcessing = micState === "processing";

  return (
    <div className="flex flex-col items-center gap-2">
      {errorMsg && (
        <p className="text-xs text-red-500 text-center max-w-xs">{errorMsg}</p>
      )}
      <button
        onClick={toggleListening}
        disabled={disabled || isProcessing}
        aria-label={isListening ? "Stop recording" : "Start recording"}
        className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400 select-none touch-none ${
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
          <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        ) : (
          <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 1a4 4 0 00-4 4v7a4 4 0 008 0V5a4 4 0 00-4-4zm-1 18.93A8.001 8.001 0 014 12H2a10 10 0 0010 10v-2.07zm2 0V22a10 10 0 0010-10h-2a8.001 8.001 0 01-7 7.93z" />
          </svg>
        )}
        {isListening && (
          <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-40" />
        )}
      </button>

      {isListening && (
        <div className="w-32 flex flex-col items-center gap-1">
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-red-500 h-1.5 rounded-full transition-all duration-1000"
              style={{ width: `${(countdown / (AUTO_STOP_MS / 1000)) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{countdown}s remaining</span>
        </div>
      )}

      <p className="text-xs text-gray-400">
        {isListening ? "Listening… click to stop" : isProcessing ? "Transcribing…" : "Click to speak"}
      </p>
    </div>
  );
}
