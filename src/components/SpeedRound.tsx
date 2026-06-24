"use client";

import { useEffect, useRef, useState } from "react";
import MicButton from "@/components/MicButton";
import { improvementMs, speedRoundBudgetsMs, SPEED_ROUND_REPS } from "@/lib/speed-round";
import type { CapturedAudio } from "@/lib/types";

interface Rep {
  url: string;
  durationMs: number;
}

interface SpeedRoundProps {
  targetText: string;
  /** The learner's original produce-first recording for this turn, if any. */
  firstAttempt?: { url: string; durationMs: number };
}

function formatSec(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function SpeedRound({ targetText, firstAttempt }: SpeedRoundProps) {
  const [open, setOpen] = useState(false);
  const [reps, setReps] = useState<Rep[]>([]);
  const repsRef = useRef<Rep[]>([]);

  const budgets = speedRoundBudgetsMs(targetText);
  const currentRound = reps.length;
  const done = currentRound >= SPEED_ROUND_REPS;

  useEffect(() => {
    repsRef.current = reps;
  }, [reps]);

  // Revoke only the URLs this component created (parent owns firstAttempt.url).
  useEffect(() => () => {
    for (const rep of repsRef.current) URL.revokeObjectURL(rep.url);
  }, []);

  const handleRep = (_transcript: string, _assessment: unknown, audio?: CapturedAudio) => {
    if (!audio) return;
    const url = URL.createObjectURL(audio.blob);
    setReps((prev) => [...prev, { url, durationMs: audio.durationMs }]);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-700 hover:bg-violet-100 transition-colors"
      >
        ⚡ Speed Round — say it 3× to lock it in
      </button>
    );
  }

  const baseline = firstAttempt ?? reps[0];
  const last = reps[reps.length - 1];
  const delta = baseline && last ? improvementMs([baseline.durationMs, last.durationMs]) : 0;

  return (
    <div className="w-full rounded-2xl border border-violet-200 bg-violet-50 px-4 py-4 flex flex-col gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-500">⚡ Speed Round</p>
        <p className="mt-1 text-sm text-gray-600">Say it 3 times — a little faster and smoother each round.</p>
      </div>

      <p className="text-gray-800 font-medium leading-relaxed text-center bg-white/70 rounded-xl px-3 py-2">
        {targetText}
      </p>

      {/* Round progress */}
      <div className="flex items-center justify-center gap-3">
        {Array.from({ length: SPEED_ROUND_REPS }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                i < reps.length
                  ? "bg-violet-600 text-white"
                  : i === currentRound
                  ? "bg-white text-violet-600 border-2 border-violet-400"
                  : "bg-white text-gray-300 border border-gray-200"
              }`}
            >
              {i + 1}
            </div>
            <span className="text-[10px] text-gray-400">
              {reps[i] ? formatSec(reps[i].durationMs) : `${Math.round(budgets[i] / 1000)}s`}
            </span>
          </div>
        ))}
      </div>

      {!done ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-violet-600">
            Round {currentRound + 1} of {SPEED_ROUND_REPS} · {Math.round(budgets[currentRound] / 1000)}s budget
          </p>
          <MicButton
            key={currentRound}
            onResult={handleRep}
            onNoSpeech={() => {}}
            disabled={false}
            mode="practice"
            referenceText={targetText}
            timeBudgetMs={budgets[currentRound]}
            variant="compact"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-violet-100 pt-3">
          {delta > 500 ? (
            <p className="text-sm font-semibold text-emerald-600 text-center">
              ⚡ You shaved {formatSec(delta)} off — faster and smoother!
            </p>
          ) : delta < -500 ? (
            <p className="text-sm font-medium text-violet-600 text-center">
              Speed comes with reps — try saying it as one smooth phrase next time.
            </p>
          ) : (
            <p className="text-sm font-medium text-violet-600 text-center">Nice and steady — well done.</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white px-3 py-2 flex flex-col gap-1">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">
                First answer · {baseline ? formatSec(baseline.durationMs) : "—"}
              </p>
              {baseline ? (
                <audio controls src={baseline.url} className="w-full" />
              ) : (
                <p className="text-xs text-gray-400">No recording</p>
              )}
            </div>
            <div className="rounded-xl bg-white px-3 py-2 flex flex-col gap-1">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">
                After speed practice · {last ? formatSec(last.durationMs) : "—"}
              </p>
              {last ? (
                <audio controls src={last.url} className="w-full" />
              ) : (
                <p className="text-xs text-gray-400">No recording</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
