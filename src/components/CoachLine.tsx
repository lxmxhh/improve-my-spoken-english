"use client";

import { useEffect, useRef } from "react";
import { pickEnglishVoice, playServerSpeechAudio, waitForSpeechVoices } from "@/lib/tts";

interface CoachLineProps {
  text: string;
  onDone: () => void;
}

export default function CoachLine({ text, onDone }: CoachLineProps) {
  const doneRef = useRef(false);
  const finishRef = useRef<() => void>(() => {});
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    doneRef.current = false;
    const words = text.split(/\s+/).filter(Boolean).length;
    const estimatedMs = Math.max(3000, words * 450);
    const serverWatchdogMs = Math.max(30000, estimatedMs + 15000);
    let forceAdvance: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (!doneRef.current) {
        doneRef.current = true;
        utteranceRef.current = null;
        if (forceAdvance) clearTimeout(forceAdvance);
        forceAdvance = null;
        onDone();
      }
    };
    finishRef.current = finish;

    const synth = typeof window === "undefined" ? null : window.speechSynthesis;
    const serverTtsAbort = new AbortController();
    let cancelled = false;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let startFallback: ReturnType<typeof setTimeout> | null = null;
    let serverTimeout: ReturnType<typeof setTimeout> | null = null;
    let started = false;

    async function speak() {
      try {
        serverTimeout = setTimeout(() => serverTtsAbort.abort(), serverWatchdogMs);
        await playServerSpeechAudio(text, "Samantha", { signal: serverTtsAbort.signal });
        if (serverTimeout) clearTimeout(serverTimeout);
        serverTimeout = null;
        if (cancelled) return;
        finish();
        return;
      } catch (error) {
        if (serverTimeout) clearTimeout(serverTimeout);
        serverTimeout = null;
        if (cancelled) return;
        console.warn("[TTS] server coach audio failed; falling back to browser voice", error);
      }

      if (cancelled) return;
      if (!synth) {
        finish();
        return;
      }

      forceAdvance = setTimeout(finish, estimatedMs + 5000);
      const voices = await waitForSpeechVoices();
      if (cancelled) return;

      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.95;

      // Chrome loads voices asynchronously; choose after voiceschanged fires.
      const enVoice = pickEnglishVoice(voices);
      if (enVoice) {
        utterance.voice = enVoice;
        utterance.lang = enVoice.lang;
      }
      utteranceRef.current = utterance;

      utterance.onstart = () => {
        started = true;
        if (startFallback) clearTimeout(startFallback);
        startFallback = null;
      };
      utterance.onend = finish;
      utterance.onerror = () => {
        if (!started) {
          synth.cancel();
          finish();
        } else {
          finish();
        }
      };

      startFallback = setTimeout(() => {
        if (!started) {
          synth.cancel();
          finish();
        }
      }, 1200);
      fallback = setTimeout(() => {
        synth.cancel();
        finish();
      }, estimatedMs + 2000);

      synth.speak(utterance);
    }

    void speak();

    return () => {
      cancelled = true;
      serverTtsAbort.abort();
      if (serverTimeout) clearTimeout(serverTimeout);
      if (fallback) clearTimeout(fallback);
      if (startFallback) clearTimeout(startFallback);
      if (forceAdvance) clearTimeout(forceAdvance);
      finishRef.current = () => {};
      utteranceRef.current = null;
      synth?.cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
      <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">
        A
      </div>
      <p className="text-gray-800 leading-relaxed pt-0.5">{text}</p>
      <button
        type="button"
        onClick={() => finishRef.current()}
        className="ml-auto flex-shrink-0 text-xs font-medium text-blue-500 hover:text-blue-700"
      >
        Continue
      </button>
    </div>
  );
}
