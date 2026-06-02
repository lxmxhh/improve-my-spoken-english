"use client";

import type { Script, UserRecording } from "@/lib/types";

interface SessionSummaryProps {
  summary: string;
  passedLines: number;
  totalLines: number;
  script: Script;
  userRecordings: Record<number, UserRecording>;
  playingTtsSource: string | null;
  onPlayCoach: (text: string, source: string) => void;
  onNext: () => void;
  onDone: () => void;
}

export default function SessionSummary({
  summary,
  passedLines,
  totalLines,
  script,
  userRecordings,
  playingTtsSource,
  onPlayCoach,
  onNext,
  onDone,
}: SessionSummaryProps) {
  const percent = totalLines > 0 ? Math.round((passedLines / totalLines) * 100) : 0;

  return (
    <div className="flex flex-col gap-6 max-w-lg mx-auto">
      <div className="text-center">
        <div className="text-5xl font-bold text-emerald-600">{percent}%</div>
        <p className="text-gray-600 mt-1">
          You nailed <span className="font-semibold text-gray-800">{passedLines}</span> out of{" "}
          <span className="font-semibold text-gray-800">{totalLines}</span> lines
        </p>
      </div>

      <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
        <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">
          Coach&apos;s Feedback
        </h3>
        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap text-sm">{summary}</p>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <h3 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">
          Conversation Replay
        </h3>
        <div className="flex flex-col gap-3">
          {script.turns.map((turn, index) => {
            const recording = userRecordings[index];
            const isCoach = turn.speaker === "coach";
            const coachSource = `summary-coach-${index}`;
            const isCoachPlaying = playingTtsSource === coachSource;
            const isTtsLocked = Boolean(playingTtsSource);

            return (
              <div
                key={`${turn.speaker}-${index}`}
                className={`rounded-xl border px-4 py-3 ${
                  isCoach ? "border-blue-100 bg-blue-50" : "border-gray-200 bg-gray-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                      isCoach ? "bg-blue-600 text-white" : "bg-gray-700 text-white"
                    }`}
                  >
                    {isCoach ? "A" : "You"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                        {isCoach ? "Alex" : "You"}
                      </p>
                      {isCoach && (
                        <button
                          type="button"
                          onClick={() => onPlayCoach(turn.text, coachSource)}
                          disabled={isTtsLocked}
                          className="w-8 h-8 rounded-full bg-blue-100 hover:bg-blue-200 disabled:hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-70 text-blue-600 flex items-center justify-center transition-colors text-base"
                          title="Play Alex"
                        >
                          {isCoachPlaying ? (
                            <span className="h-4 w-4 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
                          ) : (
                            "🔊"
                          )}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-gray-800">{turn.text}</p>
                    {!isCoach && (
                      <div className="mt-3">
                        {recording ? (
                          <audio controls src={recording.url} className="w-full" />
                        ) : (
                          <p className="text-xs text-gray-400">No voice recording for this line.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onNext}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          Start Next Topic
        </button>
        <button
          onClick={onDone}
          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          That&apos;s Enough for Today
        </button>
      </div>
    </div>
  );
}
