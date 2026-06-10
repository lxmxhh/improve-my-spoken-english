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

export type ConnectedSpeechLinkType =
  | "consonant-vowel"
  | "vowel-vowel"
  | "same-consonant"
  | "reduction";

export type IntonationContour = "falling" | "rising" | "fall-rise" | "rise-fall";

export interface ConnectedSpeechGuide {
  text: string;
  focusWords: {
    word: string;
    reason: string;
  }[];
  weakForms: {
    word: string;
    weakForm: string;
    strongForm?: string;
    reason: string;
  }[];
  linkedPhrases: {
    text: string;
    cue: string;
    type: ConnectedSpeechLinkType;
  }[];
  intonation: {
    contour: IntonationContour;
    tonalWord?: string;
    reason: string;
  };
  teachingPrompt: string;
}

export interface ConnectedSpeechAnalysis {
  topIssue: "pronunciation" | "linking" | "weak-forms" | "rhythm" | "intonation" | null;
  priorityReason: string;
  suggestedPracticeText?: string;
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
  flowGuide?: ConnectedSpeechGuide;
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
