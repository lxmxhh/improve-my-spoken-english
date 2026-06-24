"use client";

import Sparkline from "@/components/Sparkline";
import { buildProgressSeries, progressSummary } from "@/lib/progress";
import type { Session } from "@/lib/types";

interface ProgressOverviewProps {
  sessions: Session[];
}

export default function ProgressOverview({ sessions }: ProgressOverviewProps) {
  const summary = progressSummary(sessions);
  const series = buildProgressSeries(sessions);

  if (summary.sessionCount === 0) return null;

  const passValues = series.passRate.map((p) => p.value);
  const scaffoldValues = series.scaffold.map((p) => p.value);
  const showPass = passValues.length >= 2;
  const showScaffold = scaffoldValues.length >= 2;

  const firstScaffold = scaffoldValues[0];
  const lastScaffold = scaffoldValues[scaffoldValues.length - 1];
  const scaffoldDrop = showScaffold ? firstScaffold - lastScaffold : 0;

  return (
    <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-4 flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Your progress</p>

      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-gray-50 px-2 py-2">
          <div className="text-lg font-bold text-gray-800">{summary.sessionCount}</div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400">Sessions</div>
        </div>
        <div className="rounded-xl bg-gray-50 px-2 py-2">
          <div className="text-lg font-bold text-gray-800">{summary.totalMinutes}</div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400">Minutes</div>
        </div>
        <div className="rounded-xl bg-gray-50 px-2 py-2">
          <div className="text-lg font-bold text-gray-800">{summary.avgPassRate}%</div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400">Avg pass</div>
        </div>
      </div>

      {showPass && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-600">Pass rate over time</p>
            <span className="text-xs text-gray-400">higher is better</span>
          </div>
          <Sparkline values={passValues} min={0} max={100} colorClass="text-emerald-500" />
        </div>
      )}

      {showScaffold && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-600">Support needed</p>
            <span className="text-xs text-gray-400">lower = more independent</span>
          </div>
          <Sparkline values={scaffoldValues} min={0} max={2} colorClass="text-blue-500" />
          {scaffoldDrop > 0.1 && (
            <p className="text-xs text-emerald-600">
              You&apos;re leaning on hints less — speaking more on your own. Keep it up!
            </p>
          )}
        </div>
      )}
    </div>
  );
}
