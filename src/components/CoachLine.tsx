"use client";

import { useEffect, useRef } from "react";

interface CoachLineProps {
  text: string;
  onDone: () => void;
}

export default function CoachLine({ text, onDone }: CoachLineProps) {
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    if (typeof window === "undefined" || !window.speechSynthesis) {
      // TTS not available — just advance after a short delay
      const t = setTimeout(() => {
        if (!doneRef.current) { doneRef.current = true; onDone(); }
      }, 1500);
      return () => clearTimeout(t);
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.95;

    utterance.onend = () => {
      if (!doneRef.current) { doneRef.current = true; onDone(); }
    };
    utterance.onerror = () => {
      if (!doneRef.current) { doneRef.current = true; onDone(); }
    };

    // Fallback in case onend never fires (some browsers are unreliable)
    const words = text.split(" ").length;
    const estimatedMs = Math.max(3000, words * 450);
    const fallback = setTimeout(() => {
      window.speechSynthesis.cancel();
      if (!doneRef.current) { doneRef.current = true; onDone(); }
    }, estimatedMs + 2000);

    window.speechSynthesis.speak(utterance);

    return () => {
      clearTimeout(fallback);
      window.speechSynthesis.cancel();
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
