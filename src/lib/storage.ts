import type { Session, DailyRecord } from "./types";

const KEYS = {
  sessions: "esp_sessions",
  daily: "esp_daily",
  streak: "esp_streak",
} as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Sessions

export function getSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEYS.sessions) ?? "[]");
  } catch {
    return [];
  }
}

export function saveSession(session: Session): void {
  if (typeof window === "undefined") return;
  const sessions = getSessions();
  sessions.push(session);
  localStorage.setItem(KEYS.sessions, JSON.stringify(sessions));
}

// Daily records

export function getDailyRecord(date: string): DailyRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const all: DailyRecord[] = JSON.parse(
      localStorage.getItem(KEYS.daily) ?? "[]"
    );
    return all.find((r) => r.date === date) ?? null;
  } catch {
    return null;
  }
}

export function upsertDailyRecord(record: DailyRecord): void {
  if (typeof window === "undefined") return;
  try {
    const all: DailyRecord[] = JSON.parse(
      localStorage.getItem(KEYS.daily) ?? "[]"
    );
    const idx = all.findIndex((r) => r.date === record.date);
    if (idx >= 0) {
      all[idx] = record;
    } else {
      all.push(record);
    }
    localStorage.setItem(KEYS.daily, JSON.stringify(all));
  } catch {
    // ignore write errors
  }
}

// Streak

export function getStreak(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(KEYS.streak) ?? "0", 10);
}

export function setStreak(n: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEYS.streak, String(n));
}

/**
 * Called after saving a session. Updates the daily record and recalculates
 * the streak: increments if yesterday had goalMet, resets if the streak was
 * broken, preserves if today is already counted.
 */
export function computeAndUpdateStreak(sessionId: string): number {
  const date = today();
  const existing = getDailyRecord(date);
  const sessionIds = existing
    ? [...new Set([...existing.sessionIds, sessionId])]
    : [sessionId];
  const goalMet = sessionIds.length >= 3;

  let streak = getStreak();

  if (goalMet && !existing?.goalMet) {
    // Just hit the daily goal for the first time today
    const yestRecord = getDailyRecord(yesterday());
    if (yestRecord?.goalMet) {
      streak += 1;
    } else if (streak === 0) {
      streak = 1;
    } else {
      // streak was broken (yesterday not goalMet)
      streak = 1;
    }
    setStreak(streak);
  }

  upsertDailyRecord({ date, sessionIds, goalMet, streakDay: streak });
  return streak;
}
