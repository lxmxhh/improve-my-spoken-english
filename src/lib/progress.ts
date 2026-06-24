import type { Session } from "./types";

export interface ProgressPoint {
  date: string;
  value: number;
}

export interface ProgressSeries {
  passRate: ProgressPoint[]; // % of lines passed, higher is better
  scaffold: ProgressPoint[]; // avg scaffold level (0–2), lower = more independent
}

export interface ProgressSummary {
  sessionCount: number;
  totalMinutes: number;
  avgPassRate: number; // 0–100
}

export function passRatePercent(session: Session): number {
  return session.totalLines > 0
    ? Math.round((session.passedLines / session.totalLines) * 100)
    : 0;
}

/** Oldest → newest, using completedAt then date as the ordering key. */
export function sortByTimeAsc(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) =>
    (a.completedAt || a.date).localeCompare(b.completedAt || b.date)
  );
}

export function buildProgressSeries(sessions: Session[]): ProgressSeries {
  const ordered = sortByTimeAsc(sessions);
  return {
    passRate: ordered.map((s) => ({ date: s.date, value: passRatePercent(s) })),
    scaffold: ordered
      .filter((s) => s.avgScaffoldLevel !== undefined)
      .map((s) => ({ date: s.date, value: Number(s.avgScaffoldLevel) })),
  };
}

export function progressSummary(sessions: Session[]): ProgressSummary {
  const sessionCount = sessions.length;
  const totalSeconds = sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0);
  const avgPassRate = sessionCount > 0
    ? Math.round(sessions.reduce((sum, s) => sum + passRatePercent(s), 0) / sessionCount)
    : 0;
  return {
    sessionCount,
    totalMinutes: Math.round(totalSeconds / 60),
    avgPassRate,
  };
}
