"use client";

import { useEffect, useRef, useState } from "react";

interface MicButtonProps {
  onResult: (transcript: string) => void;
  onNoSpeech: () => void;
  disabled: boolean;
}

type MicState = "idle" | "listening" | "processing";

const TIMEOUT_MS = 60_000;
const NO_SPEECH_MS = 10_000;

export default function MicButton({ onResult, onNoSpeech, disabled }: MicButtonProps) {
  const [micState, setMicState] = useState<MicState>("idle");
  const [countdown, setCountdown] = useState(TIMEOUT_MS / 1000);

  // Use a ref to track the real current state — avoids stale closures in event handlers
  const stateRef = useRef<MicState>("idle");
  const recognitionRef = useRef<InstanceType<typeof window.SpeechRecognition> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noSpeechRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gotResultRef = useRef(false);

  function setState(s: MicState) {
    stateRef.current = s;
    setMicState(s);
  }

  function clearTimers() {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (noSpeechRef.current) clearTimeout(noSpeechRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }

  function startListening(e: React.PointerEvent) {
    e.preventDefault(); // prevent any synthetic click from re-triggering
    if (disabled || stateRef.current !== "idle") return;

    const SpeechRecognition =
      (window as Window).SpeechRecognition ?? (window as Window).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;
    gotResultRef.current = false;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      gotResultRef.current = true;
      clearTimers();
      setState("processing");
      onResult(transcript);
    };

    recognition.onend = () => {
      if (!gotResultRef.current) {
        clearTimers();
        setState("idle");
        setCountdown(TIMEOUT_MS / 1000);
        onNoSpeech();
      }
    };

    recognition.onerror = () => {
      clearTimers();
      setState("idle");
      setCountdown(TIMEOUT_MS / 1000);
      onNoSpeech();
    };

    recognition.start();
    setState("listening");
    setCountdown(TIMEOUT_MS / 1000);

    // 60-second hard stop
    autoStopRef.current = setTimeout(() => {
      recognitionRef.current?.stop();
    }, TIMEOUT_MS);

    // 10-second silence detection
    noSpeechRef.current = setTimeout(() => {
      if (!gotResultRef.current) {
        recognitionRef.current?.stop();
      }
    }, NO_SPEECH_MS);

    // Countdown display
    countdownRef.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
  }

  function stopListening(e: React.PointerEvent) {
    e.preventDefault();
    if (stateRef.current !== "listening") return;
    recognitionRef.current?.stop();
    // onend will fire and clean up
  }

  // Reset to idle when parent clears the disabled flag after evaluation
  useEffect(() => {
    if (!disabled && stateRef.current === "processing") {
      setState("idle");
      setCountdown(TIMEOUT_MS / 1000);
    }
  }, [disabled]);

  useEffect(() => () => clearTimers(), []);

  const isListening = micState === "listening";
  const isProcessing = micState === "processing";

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onPointerDown={startListening}
        onPointerUp={stopListening}
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
              style={{ width: `${(countdown / (TIMEOUT_MS / 1000)) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{countdown}s remaining</span>
        </div>
      )}

      <p className="text-xs text-gray-400">
        {isListening ? "Listening… release to submit" : isProcessing ? "Checking…" : "Tap to speak"}
      </p>
    </div>
  );
}
