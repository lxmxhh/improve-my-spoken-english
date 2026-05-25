"use client";

import { useEffect, useRef } from "react";
import { pickEnglishVoice, playMacSpeechAudio, waitForSpeechVoices } from "@/lib/tts";

interface CoachLineProps {
  text: string;
  onDone: () => void;
}

export default function CoachLine({ text, onDone }: CoachLineProps) {
  const doneRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    doneRef.current = false;
    if (typeof window === "undefined" || !window.speechSynthesis) {
      // TTS not available — just advance after a short delay
      const t = setTimeout(() => {
        if (!doneRef.current) { doneRef.current = true; onDone(); }
      }, 1500);
      return () => clearTimeout(t);
    }

    const synth = window.speechSynthesis;
    let cancelled = false;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let startFallback: ReturnType<typeof setTimeout> | null = null;
    let started = false;
    let fallbackStarted = false;

    const finish = () => {
      if (!doneRef.current) {
        doneRef.current = true;
        utteranceRef.current = null;
        onDone();
      }
    };

    async function speak() {
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

      const playMacFallback = async () => {
        if (fallbackStarted || cancelled) return;
        fallbackStarted = true;
        synth.cancel();
        if (fallback) clearTimeout(fallback);
        fallback = null;
        try {
          await playMacSpeechAudio(text, "Samantha");
        } finally {
          finish();
        }
      };

      utterance.onstart = () => {
        started = true;
        if (startFallback) clearTimeout(startFallback);
        startFallback = null;
      };
      utterance.onend = finish;
      utterance.onerror = () => {
        if (!started) {
          void playMacFallback();
        } else {
          finish();
        }
      };

      const words = text.split(" ").length;
      const estimatedMs = Math.max(3000, words * 450);
      startFallback = setTimeout(() => {
        if (!started) void playMacFallback();
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
      if (fallback) clearTimeout(fallback);
      if (startFallback) clearTimeout(startFallback);
      utteranceRef.current = null;
      synth.cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
      <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">
        A
      </div>
      <p className="text-gray-800 leading-relaxed pt-0.5">{text}</p>
    </div>
  );
}
