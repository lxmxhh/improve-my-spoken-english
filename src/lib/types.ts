export interface ScriptTurn {
  speaker: "coach" | "user";
  text: string;
  hint?: string;
}

export interface Script {
  topic: string;
  category: string;
  turns: ScriptTurn[];
}

export interface TurnResult {
  turnIndex: number;
  passed: boolean;
}

export interface Session {
  id: string;
  date: string;
  topic: string;
  category: string;
  durationSec: number;
  totalLines: number;
  passedLines: number;
  failedLines: number;
  summary: string;
  completedAt: string;
}

export interface DailyRecord {
  date: string;
  sessionIds: string[];
  goalMet: boolean;
  streakDay: number;
}
