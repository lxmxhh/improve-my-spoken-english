"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

function getSpeechInputIssue() {
  if (typeof window === "undefined") return null;
  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (!window.isSecureContext && !isLocalhost) {
    return "Mobile microphone access requires HTTPS. Use a trusted HTTPS tunnel or certificate for phone testing.";
  }

  const hasGetUserMedia =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
  const hasWorkletCapture =
    "AudioContext" in window &&
    "AudioWorkletNode" in window;
  const hasMediaRecorder = "MediaRecorder" in window;
  if (!(hasGetUserMedia && (hasWorkletCapture || hasMediaRecorder))) {
    return "Voice recording requires microphone access and browser audio recording support.";
  }

  return null;
}

export default function BrowserWarning() {
  const issue = useSyncExternalStore(
    subscribe,
    getSpeechInputIssue,
    () => null
  );

  if (!issue) return null;

  return (
    <div className="w-full bg-amber-400 text-amber-900 text-sm text-center py-2 px-4 font-medium">
      {issue}
    </div>
  );
}
