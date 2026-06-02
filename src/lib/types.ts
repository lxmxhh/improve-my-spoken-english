export type PracticeMode = "practice" | "assessment";

export interface PronunciationAssessment {
  transcript?: string;
  pass: boolean;
  pronunciationScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  words?: {
    word: string;
    accuracyScore?: number;
    errorType?: string;
  }[];
}

export interface UserRecording {
  url: string;
  mimeType: string;
  durationMs: number;
}

export interface CapturedAudio {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface PronunciationCoachTip {
  type: "pronunciation" | "naturalness";
  target?: string;
  advice: string;
  practiceText?: string;
}

export interface PronunciationCoachFeedback {
  summary: string;
  tips: PronunciationCoachTip[];
  retryPrompt: string;
}

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
