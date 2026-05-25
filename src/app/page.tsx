"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProgressRings from "@/components/ProgressRings";
import { getDailyRecord, getStreak } from "@/lib/storage";

export default function HomePage() {
  const [completed, setCompleted] = useState(0);
  const [streak, setStreak] = useState(0);
  const [goalMet, setGoalMet] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const record = getDailyRecord(today);
    setCompleted(Math.min(record?.sessionIds.length ?? 0, 3));
    setGoalMet(record?.goalMet ?? false);
    setStreak(getStreak());
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 gap-10">
      {goalMet && (
        <div className="w-full max-w-sm bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 text-center">
          <p className="text-emerald-700 font-semibold text-lg">🎉 Daily goal complete!</p>
          <p className="text-emerald-600 text-sm mt-1">Amazing work today. See you tomorrow!</p>
        </div>
      )}

      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-bold text-gray-900">English Practice</h1>
        <p className="text-gray-500 max-w-xs">
          Practice speaking English every day with your AI coach Alex.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-gray-500 font-medium">Today&apos;s progress</p>
        <ProgressRings completed={completed} streak={streak} />
        <p className="text-xs text-gray-400">{completed}/3 topics completed</p>
      </div>

      <div className="flex flex-col items-center gap-3 w-full max-w-xs">
        <Link
          href="/session"
          className="w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 rounded-xl transition-colors text-lg shadow-sm"
        >
          {completed === 0 ? "Start Practice" : completed >= 3 ? "Keep Practicing" : "Continue Practice"}
        </Link>
        {completed > 0 && (
          <Link
            href="/history"
            className="w-full text-center text-gray-500 hover:text-gray-700 text-sm py-2 transition-colors"
          >
            View past sessions →
          </Link>
        )}
      </div>
    </div>
  );
}
