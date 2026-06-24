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

/**
 * Pre-generated acceptable-answer space for a coach question.
 * Powers the "produce first, reveal later" flow and lenient direction judging.
 * All fields optional at the boundary — older scripts have no anchor.
 */
export interface CoachPromptAnchor {
  intent: string; // communicative function, e.g. "describe a past routine"
  keyPoints: string[]; // 2–3 acceptable answer directions
  sampleAnswer: string; // model answer, revealed after the user produces
}

export interface ScriptTurn {
  speaker: "coach" | "user";
  text: string;
  hint?: string;
  flowGuide?: ConnectedSpeechGuide;
  anchor?: CoachPromptAnchor;
}

export interface Script {
  topic: string;
  category: string;
  turns: ScriptTurn[];
}

export interface TurnResult {
  turnIndex: number;
  passed: boolean;
  scaffoldLevel?: number; // 0–4: how much support the user needed this turn
  hintsUsed?: number; // number of times the user dropped a scaffold rung
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
  avgScaffoldLevel?: number; // mean scaffold rung across user turns (lower = more independent)
  expressionItemsMastered?: number; // reserved for Phase 3 closed-loop tracking
}

export interface DailyRecord {
  date: string;
  sessionIds: string[];
  goalMet: boolean;
  streakDay: number;
}
