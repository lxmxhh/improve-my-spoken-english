"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

function getSpeechInputUnsupported() {
  if (typeof window === "undefined") return false;
  const hasGetUserMedia =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
  return !(
    hasGetUserMedia &&
    "MediaRecorder" in window
  );
}

export default function BrowserWarning() {
  const unsupported = useSyncExternalStore(
    subscribe,
    getSpeechInputUnsupported,
    () => false
  );

  if (!unsupported) return null;

  return (
    <div className="w-full bg-amber-400 text-amber-900 text-sm text-center py-2 px-4 font-medium">
      Voice recording requires microphone and MediaRecorder support in this
      browser.
    </div>
  );
}
