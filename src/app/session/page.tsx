"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import CoachLine from "@/components/CoachLine";
import FlowGuide from "@/components/FlowGuide";
import MicButton from "@/components/MicButton";
import PromptScaffold from "@/components/PromptScaffold";
import SessionSummary from "@/components/SessionSummary";
import SpeedRound from "@/components/SpeedRound";
import { getBuiltinScripts, getImmediateFileScript, getImmediateScript, getScriptKey, recordScriptPerformance, refillScriptPool, SCRIPT_CATEGORIES, upsertFileCachedScript } from "@/lib/script-pool";
import { saveSession, computeAndUpdateStreak } from "@/lib/storage";
import type {
  CapturedAudio,
  ConnectedSpeechGuide,
  PracticeMode,
  PronunciationAssessment,
  PronunciationCoachFeedback,
  PronunciationCoachTip,
  Script,
  ScriptTurn,
  TurnResult,
  UserRecording,
} from "@/lib/types";
import { pickEnglishVoice, playServerSpeechAudio, prewarmServerSpeechTexts, waitForSpeechVoices } from "@/lib/tts";

const DEBUG_TTS = process.env.NEXT_PUBLIC_DEBUG_TTS === "1";

interface TipPracticeResult {
  transcript: string;
  assessment?: PronunciationAssessment;
  feedback?: PronunciationCoachFeedback;
  loading: boolean;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "loading" | "warmup" | "conversation" | "summarizing" | "summary";
type CoachVoiceWarmupStatus = "idle" | "loading" | "ready" | "failed";

interface State {
  stage: Stage;
  script: Script | null;
  userTurnIndices: number[]; // indices in script.turns that are user turns
  currentUserTurnPos: number; // position within userTurnIndices
  currentScriptIndex: number; // actual index in script.turns being rendered
  attempt: 0 | 1;
  results: TurnResult[];
  elapsedSec: number;
  evaluating: boolean;
  summary: string;
  lastFeedback: "pass" | "fail" | null;
  pendingPassAdvance: boolean;
}

type Action =
  | { type: "SCRIPT_LOADED"; script: Script }
  | { type: "START_CONVERSATION" }
  | { type: "COACH_DONE" }
  | { type: "EVAL_RESULT"; passed: boolean; turnIndex: number; scaffoldLevel?: number; hintsUsed?: number }
  | { type: "PASS_HOLD"; turnIndex: number; scaffoldLevel?: number; hintsUsed?: number }
  | { type: "ADVANCE_AFTER_PASS" }
  | { type: "PRACTICE_REPEAT_RESULT"; passed: boolean }
  | { type: "FLOW_GUIDE_READY"; turnIndex: number; guide: ConnectedSpeechGuide }
  | { type: "CLEAR_FEEDBACK" }
  | { type: "EVALUATING"; value: boolean }
  | { type: "TICK"; enforceLimit: boolean }
  | { type: "SUMMARY_READY"; summary: string }
  | { type: "RESET" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserTurnIndices(turns: ScriptTurn[]): number[] {
  return turns.reduce<number[]>((acc, t, i) => {
    if (t.speaker === "user") acc.push(i);
    return acc;
  }, []);
}

function extractKeywords(script: Script): string[] {
  const allText = script.turns.map((t) => t.text).join(" ");
  const stopWords = new Set([
    "the", "a", "an", "is", "it", "in", "on", "at", "to", "of", "and",
    "for", "do", "you", "i", "my", "your", "we", "that", "this", "was",
    "are", "be", "have", "has", "with", "about", "but", "so", "as", "up",
    "not", "from", "or", "by", "if", "how", "what", "when", "where", "who",
  ]);
  const freq: Record<string, number> = {};
  allText
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .forEach((w) => { freq[w] = (freq[w] ?? 0) + 1; });
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
}

function getReferenceText(turn?: ScriptTurn) {
  if (!turn) return "";
  return turn.hint ?? turn.text;
}

function getPreviousCoachLine(turns: ScriptTurn[], currentScriptIndex: number) {
  return turns
    .slice(0, currentScriptIndex)
    .reverse()
    .find((turn) => turn.speaker === "coach")?.text ?? "";
}

function getCoachLines(script: Script | null) {
  return script?.turns
    .filter((turn) => turn.speaker === "coach")
    .map((turn) => turn.text.trim())
    .filter(Boolean) ?? [];
}

function getFirstCoachLine(script: Script | null) {
  return getCoachLines(script)[0] ?? "";
}

function getNextCoachLine(turns: ScriptTurn[], currentScriptIndex: number) {
  return turns
    .slice(currentScriptIndex + 1)
    .find((turn) => turn.speaker === "coach")?.text.trim() ?? "";
}

function getFlowGuideKey(referenceText: string, previousCoachLine: string) {
  return `${referenceText}\n---\n${previousCoachLine}`;
}

const CATEGORIES = [...SCRIPT_CATEGORIES];
const SESSION_MAX_SEC = 300;
const SUMMARY_TIMEOUT_MS = 12_000;
const BACKGROUND_REFILL_DELAY_MS = 12_000;

const FALLBACK_SESSION_SUMMARY = "Great job! Keep practicing every day!";

async function fetchSessionSummary(script: Script, passedLines: number, totalLines: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

  try {
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script, passedLines, totalLines }),
      signal: controller.signal,
    });

    if (!res.ok) return FALLBACK_SESSION_SUMMARY;
    const data = await res.json() as { summary?: string };
    return data.summary?.trim() || FALLBACK_SESSION_SUMMARY;
  } finally {
    clearTimeout(timeout);
  }
}

function createInitialState(): State {
  const script =
    getBuiltinScripts().find((item) => item.category === CATEGORIES[0]) ??
    getBuiltinScripts()[0];
  return {
    stage: "warmup",
    script,
    userTurnIndices: getUserTurnIndices(script.turns),
    currentUserTurnPos: 0,
    currentScriptIndex: 0,
    attempt: 0,
    results: [],
    elapsedSec: 0,
    evaluating: false,
    summary: "",
    lastFeedback: null,
    pendingPassAdvance: false,
  };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

const initial: State = createInitialState();

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SCRIPT_LOADED": {
      if (state.stage !== "warmup" && state.stage !== "loading") {
        return state;
      }
      const indices = getUserTurnIndices(action.script.turns);
      return {
        ...state,
        stage: "warmup",
        script: action.script,
        userTurnIndices: indices,
        currentScriptIndex: 0,
        currentUserTurnPos: 0,
      };
    }
    case "START_CONVERSATION":
      return { ...state, stage: "conversation", elapsedSec: 0 };
    case "COACH_DONE": {
      // Advance past consecutive coach turns until we hit a user turn or end
      const turns = state.script!.turns;
      let next = state.currentScriptIndex + 1;
      while (next < turns.length && turns[next].speaker === "coach") next++;
      if (next >= turns.length) {
        // No more turns — go to summarizing
        return { ...state, stage: "summarizing" };
      }
      return { ...state, currentScriptIndex: next };
    }
    case "EVALUATING":
      return { ...state, evaluating: action.value };
    case "PASS_HOLD": {
      const result: TurnResult = {
        turnIndex: action.turnIndex,
        passed: true,
        ...(action.scaffoldLevel !== undefined ? { scaffoldLevel: action.scaffoldLevel } : {}),
        ...(action.hintsUsed !== undefined ? { hintsUsed: action.hintsUsed } : {}),
      };
      return {
        ...state,
        results: [...state.results, result],
        attempt: 0,
        evaluating: false,
        lastFeedback: "pass",
        pendingPassAdvance: true,
      };
    }
    case "ADVANCE_AFTER_PASS": {
      if (!state.script) return state;
      if (!state.pendingPassAdvance) return state;
      const turns = state.script.turns;
      const next = state.currentScriptIndex + 1;
      if (next >= turns.length) {
        return {
          ...state,
          stage: "summarizing",
          pendingPassAdvance: false,
        };
      }
      return {
        ...state,
        currentScriptIndex: next,
        currentUserTurnPos: state.currentUserTurnPos + 1,
        pendingPassAdvance: false,
      };
    }
    case "PRACTICE_REPEAT_RESULT":
      return {
        ...state,
        evaluating: false,
        pendingPassAdvance: true,
        lastFeedback: action.passed ? "pass" : "fail",
      };
    case "FLOW_GUIDE_READY": {
      if (!state.script) return state;
      const turn = state.script.turns[action.turnIndex];
      if (!turn || turn.speaker !== "user") return state;
      return {
        ...state,
        script: {
          ...state.script,
          turns: state.script.turns.map((item, index) => (
            index === action.turnIndex ? { ...item, flowGuide: action.guide } : item
          )),
        },
      };
    }
    case "CLEAR_FEEDBACK":
      return { ...state, lastFeedback: null };
    case "EVAL_RESULT": {
      if (action.passed || state.attempt === 1) {
        // The turn is complete, but stay on the answer page until the user continues.
        const result: TurnResult = {
          turnIndex: action.turnIndex,
          passed: action.passed,
          ...(action.scaffoldLevel !== undefined ? { scaffoldLevel: action.scaffoldLevel } : {}),
          ...(action.hintsUsed !== undefined ? { hintsUsed: action.hintsUsed } : {}),
        };
        return {
          ...state,
          results: [...state.results, result],
          attempt: 0,
          evaluating: false,
          pendingPassAdvance: true,
          lastFeedback: action.passed ? "pass" : "fail",
        };
      } else {
        // First attempt failed — allow retry
        return { ...state, attempt: 1, evaluating: false, pendingPassAdvance: false, lastFeedback: "fail" };
      }
    }
    case "TICK": {
      const elapsed = state.elapsedSec + 1;
      if (action.enforceLimit && elapsed >= SESSION_MAX_SEC && state.stage === "conversation") {
        return { ...state, elapsedSec: elapsed, stage: "summarizing" };
      }
      return { ...state, elapsedSec: elapsed };
    }
    case "SUMMARY_READY":
      return { ...state, stage: "summary", summary: action.summary };
    case "RESET":
      return { ...initial };
    default:
      return state;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SessionPage() {
  const [state, dispatch] = useReducer(reducer, initial);
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const passAdvanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passAdvanceCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const summarizingRef = useRef(false);
  const manualTtsRef = useRef<SpeechSynthesisUtterance | null>(null);
  const manualTtsFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [textInput, setTextInput] = useState("");
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastAssessment, setLastAssessment] = useState<PronunciationAssessment | null>(null);
  const [coachFeedback, setCoachFeedback] = useState<PronunciationCoachFeedback | null>(null);
  const [coachFeedbackLoading, setCoachFeedbackLoading] = useState(false);
  const [tipPracticeResults, setTipPracticeResults] = useState<Record<string, TipPracticeResult>>({});
  const [playingTtsSource, setPlayingTtsSource] = useState<string | null>(null);
  const [mode, setMode] = useState<PracticeMode>("practice");
  const [hintTier, setHintTier] = useState(0);
  const hintTierRef = useRef(0);
  const [coachVoiceWarmup, setCoachVoiceWarmup] = useState<CoachVoiceWarmupStatus>("idle");
  const [userRecordings, setUserRecordings] = useState<Record<number, UserRecording>>({});
  const [flowGuides, setFlowGuides] = useState<Record<string, ConnectedSpeechGuide | null>>({});
  const [flowGuideLoadingKeys, setFlowGuideLoadingKeys] = useState<Record<string, boolean>>({});
  const userRecordingsRef = useRef<Record<number, UserRecording>>({});
  const flowGuidesRef = useRef<Record<string, ConnectedSpeechGuide | null>>({});
  const flowGuideLoadingKeysRef = useRef<Record<string, boolean>>({});
  const scriptWithFlowGuidesRef = useRef<Script | null>(initial.script);
  const flowGuideSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flowGuideSaveInFlightRef = useRef(false);
  const coachVoiceWarmupKeysRef = useRef<Set<string>>(new Set());

  const loadNextScript = useCallback(() => {
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    dispatch({ type: "SCRIPT_LOADED", script: getImmediateScript(category) });
    void getImmediateFileScript(category)
      .then((script) => {
        dispatch({ type: "SCRIPT_LOADED", script });
      })
      .catch((error) => {
        console.warn("[script-pool] file script load failed:", error);
      });
    setTimeout(() => {
      void refillScriptPool(category);
    }, BACKGROUND_REFILL_DELAY_MS);
  }, []);

  const clearSessionUiState = useCallback(() => {
    setTextInput("");
    setLastTranscript(null);
    setLastAssessment(null);
    setCoachFeedback(null);
    setCoachFeedbackLoading(false);
    setTipPracticeResults({});
    setPlayingTtsSource(null);
    if (manualTtsFallbackRef.current) clearTimeout(manualTtsFallbackRef.current);
    manualTtsFallbackRef.current = null;
    manualTtsRef.current = null;
    if (passAdvanceTimeoutRef.current) clearTimeout(passAdvanceTimeoutRef.current);
    passAdvanceTimeoutRef.current = null;
    if (passAdvanceCountdownRef.current) clearInterval(passAdvanceCountdownRef.current);
    passAdvanceCountdownRef.current = null;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const clearConversationReplay = useCallback(() => {
    for (const recording of Object.values(userRecordingsRef.current)) {
      URL.revokeObjectURL(recording.url);
    }
    userRecordingsRef.current = {};
    setUserRecordings({});
  }, []);

  const saveUserRecording = useCallback((turnIndex: number, audio: CapturedAudio) => {
    const recording: UserRecording = {
      url: URL.createObjectURL(audio.blob),
      mimeType: audio.mimeType,
      durationMs: audio.durationMs,
    };

    setUserRecordings((current) => {
      if (current[turnIndex]?.url) {
        URL.revokeObjectURL(current[turnIndex].url);
      }
      const next = { ...current, [turnIndex]: recording };
      userRecordingsRef.current = next;
      return next;
    });
  }, []);

  const fetchCoachFeedback = useCallback(
    async (
      referenceText: string,
      transcript: string,
      assessment?: PronunciationAssessment,
      connectedSpeechGuide?: ConnectedSpeechGuide | null
    ) => {
      setCoachFeedbackLoading(true);
      setCoachFeedback(null);
      try {
        const response = await fetch("/api/pronunciation-coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            referenceText,
            transcript,
            ...(assessment ? { assessment } : {}),
            ...(connectedSpeechGuide ? { connectedSpeechGuide } : {}),
          }),
        });
        const data = await response.json() as PronunciationCoachFeedback & { error?: string };
        if (response.ok && !data.error) {
          setCoachFeedback(data);
        }
      } catch (error) {
        console.warn("[coach-feedback] failed:", error);
      } finally {
        setCoachFeedbackLoading(false);
      }
    },
    []
  );

  const fetchFreeCoachFeedback = useCallback(
    async (transcript: string, question: string, modelAnswer: string) => {
      setCoachFeedbackLoading(true);
      setCoachFeedback(null);
      try {
        const response = await fetch("/api/pronunciation-coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "free", transcript, question, modelAnswer }),
        });
        const data = await response.json() as PronunciationCoachFeedback & { error?: string };
        if (response.ok && !data.error) {
          setCoachFeedback(data);
        }
      } catch (error) {
        console.warn("[coach-feedback:free] failed:", error);
      } finally {
        setCoachFeedbackLoading(false);
      }
    },
    []
  );

  const getTipPracticeText = useCallback((tip: PronunciationCoachTip, fallbackText: string) => {
    return tip.practiceText?.trim() || tip.target?.trim() || fallbackText;
  }, []);

  const scheduleFlowGuideScriptSave = useCallback(() => {
    if (flowGuideSaveTimeoutRef.current) {
      clearTimeout(flowGuideSaveTimeoutRef.current);
    }

    const saveWhenReady = async () => {
      if (flowGuideSaveInFlightRef.current) {
        flowGuideSaveTimeoutRef.current = setTimeout(() => {
          void saveWhenReady();
        }, 800);
        return;
      }

      const script = scriptWithFlowGuidesRef.current;
      if (!script) return;

      flowGuideSaveInFlightRef.current = true;
      try {
        await upsertFileCachedScript(getScriptKey(script), script);
      } catch (error) {
        console.warn("[flow-guide] script save failed:", error);
      } finally {
        flowGuideSaveInFlightRef.current = false;
      }
    };

    flowGuideSaveTimeoutRef.current = setTimeout(() => {
      void saveWhenReady();
    }, 800);
  }, []);

  const prefetchFlowGuide = useCallback((referenceText: string, previousCoachLine: string, turnIndex: number) => {
    const key = getFlowGuideKey(referenceText, previousCoachLine);
    if (
      Object.prototype.hasOwnProperty.call(flowGuidesRef.current, key) ||
      flowGuideLoadingKeysRef.current[key]
    ) {
      return;
    }

    flowGuideLoadingKeysRef.current = { ...flowGuideLoadingKeysRef.current, [key]: true };
    setFlowGuideLoadingKeys((current) => ({ ...current, [key]: true }));

    const loadFlowGuide = async () => {
      try {
        const response = await fetch("/api/connected-speech-guide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: referenceText,
            previousCoachLine,
            level: "B1",
          }),
        });
        const data = await response.json() as ConnectedSpeechGuide & { error?: string };
        const guide = response.ok && !data.error ? data : null;

        flowGuidesRef.current = { ...flowGuidesRef.current, [key]: guide };
        setFlowGuides((current) => ({ ...current, [key]: guide }));

        if (guide) {
          const currentScript = scriptWithFlowGuidesRef.current;
          const turn = currentScript?.turns[turnIndex];
          if (
            currentScript &&
            turn?.speaker === "user" &&
            getFlowGuideKey(getReferenceText(turn), getPreviousCoachLine(currentScript.turns, turnIndex)) === key
          ) {
            const nextScript: Script = {
              ...currentScript,
              turns: currentScript.turns.map((item, index) => (
                index === turnIndex ? { ...item, flowGuide: guide } : item
              )),
            };
            scriptWithFlowGuidesRef.current = nextScript;
            dispatch({ type: "FLOW_GUIDE_READY", turnIndex, guide });
            scheduleFlowGuideScriptSave();
          }
        }
      } catch (error) {
        console.warn("[flow-guide] failed:", error);
        flowGuidesRef.current = { ...flowGuidesRef.current, [key]: null };
        setFlowGuides((current) => ({ ...current, [key]: null }));
      } finally {
        const nextLoading = { ...flowGuideLoadingKeysRef.current };
        delete nextLoading[key];
        flowGuideLoadingKeysRef.current = nextLoading;
        setFlowGuideLoadingKeys((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    };

    void loadFlowGuide();
  }, [scheduleFlowGuideScriptSave]);

  const handleTipPracticeResult = useCallback(
    async (
      key: string,
      referenceText: string,
      transcript: string,
      assessment?: PronunciationAssessment
    ) => {
      setTipPracticeResults((current) => ({
        ...current,
        [key]: { transcript, assessment, loading: true },
      }));

      try {
        const response = await fetch("/api/pronunciation-coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            referenceText,
            transcript,
            ...(assessment ? { assessment } : {}),
          }),
        });
        const feedback = await response.json() as PronunciationCoachFeedback & { error?: string };
        setTipPracticeResults((current) => ({
          ...current,
          [key]: {
            transcript,
            assessment,
            feedback: response.ok && !feedback.error ? feedback : undefined,
            loading: false,
          },
        }));
      } catch (error) {
        console.warn("[tip-practice] coach feedback failed:", error);
        setTipPracticeResults((current) => ({
          ...current,
          [key]: { transcript, assessment, loading: false },
        }));
      }
    },
    []
  );

  // Load script on mount
  useEffect(() => {
    loadNextScript();
  }, [loadNextScript]);

  useEffect(() => {
    if (!state.script) return;
    scriptWithFlowGuidesRef.current = state.script;

    const seededGuides: Record<string, ConnectedSpeechGuide | null> = {};
    state.script.turns.forEach((turn, index) => {
      if (turn.speaker !== "user" || !turn.flowGuide) return;
      const key = getFlowGuideKey(
        getReferenceText(turn),
        getPreviousCoachLine(state.script!.turns, index)
      );
      seededGuides[key] = turn.flowGuide;
    });

    if (Object.keys(seededGuides).length === 0) return;
    flowGuidesRef.current = { ...flowGuidesRef.current, ...seededGuides };
    const timeout = setTimeout(() => {
      setFlowGuides((current) => ({ ...current, ...seededGuides }));
    }, 0);
    return () => clearTimeout(timeout);
  }, [state.script]);

  useEffect(() => {
    let statusTimeout: ReturnType<typeof setTimeout> | null = null;
    const setWarmupStatusSoon = (status: CoachVoiceWarmupStatus) => {
      if (statusTimeout) clearTimeout(statusTimeout);
      statusTimeout = setTimeout(() => {
        setCoachVoiceWarmup(status);
      }, 0);
    };

    const firstCoachLine = getFirstCoachLine(state.script);
    if (!firstCoachLine) {
      setWarmupStatusSoon("failed");
      return () => {
        if (statusTimeout) clearTimeout(statusTimeout);
      };
    }

    const warmupKey = `${getScriptKey(state.script!)}:${firstCoachLine}`;
    if (coachVoiceWarmupKeysRef.current.has(warmupKey)) {
      setWarmupStatusSoon("ready");
      return () => {
        if (statusTimeout) clearTimeout(statusTimeout);
      };
    }

    const controller = new AbortController();
    setWarmupStatusSoon("loading");

    void prewarmServerSpeechTexts([firstCoachLine], {
      signal: controller.signal,
      fetchTimeoutMs: 30_000,
    })
      .then(() => {
        coachVoiceWarmupKeysRef.current.add(warmupKey);
        if (!controller.signal.aborted) setWarmupStatusSoon("ready");
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn("[TTS] coach voice warmup failed:", error);
          setWarmupStatusSoon("failed");
        }
      });

    return () => {
      controller.abort();
      if (statusTimeout) clearTimeout(statusTimeout);
    };
  }, [state.script]);

  useEffect(() => {
    if (!state.script || state.stage !== "conversation") return;

    const currentTurn = state.script.turns[state.currentScriptIndex];
    if (!currentTurn || currentTurn.speaker !== "user") return;

    const texts = [
      getReferenceText(currentTurn),
      getNextCoachLine(state.script.turns, state.currentScriptIndex),
    ].map((text) => text.trim()).filter(Boolean);
    if (texts.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void prewarmServerSpeechTexts(texts, {
        signal: controller.signal,
        fetchTimeoutMs: 60_000,
      }).catch((error) => {
        if (!controller.signal.aborted) {
          console.warn("[TTS] answer-window prewarm failed:", error);
        }
      });
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [state.currentScriptIndex, state.script, state.stage]);

  // Timer during conversation
  useEffect(() => {
    if (state.stage === "conversation") {
      timerRef.current = setInterval(() => {
        dispatch({ type: "TICK", enforceLimit: mode === "assessment" });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [mode, state.stage]);

  // Trigger summary generation
  const runSummarize = useCallback(async () => {
    if (summarizingRef.current || !state.script) return;
    summarizingRef.current = true;

    const totalLines = state.userTurnIndices.length;
    const passedLines = state.results.filter((r) => r.passed).length;
    const scaffoldLevels = state.results
      .map((r) => r.scaffoldLevel)
      .filter((v): v is number => v !== undefined);
    const avgScaffoldLevel = scaffoldLevels.length > 0
      ? scaffoldLevels.reduce((a, b) => a + b, 0) / scaffoldLevels.length
      : undefined;

    // Save session to localStorage
    const session = {
      id: uuidv4(),
      date: new Date().toISOString().slice(0, 10),
      topic: state.script.topic,
      category: state.script.category,
      durationSec: state.elapsedSec,
      totalLines,
      passedLines,
      failedLines: totalLines - passedLines,
      summary: "",
      completedAt: new Date().toISOString(),
      ...(avgScaffoldLevel !== undefined ? { avgScaffoldLevel } : {}),
    };

    try {
      const summary = await fetchSessionSummary(state.script, passedLines, totalLines);
      session.summary = summary;
      dispatch({ type: "SUMMARY_READY", summary });
    } catch {
      session.summary = FALLBACK_SESSION_SUMMARY;
      dispatch({ type: "SUMMARY_READY", summary: session.summary });
    }

    try {
      saveSession(session);
      computeAndUpdateStreak(session.id);
      recordScriptPerformance(state.script, passedLines, totalLines);
    } catch (error) {
      console.warn("[session-summary] failed to persist session:", error);
    }
  }, [state.script, state.userTurnIndices, state.results, state.elapsedSec]);

  useEffect(() => {
    if (state.stage === "summarizing") {
      runSummarize();
    }
  }, [state.stage, runSummarize]);

  // Evaluate user speech
  const handleTranscript = useCallback(
    async (transcript: string, assessment?: PronunciationAssessment, audio?: CapturedAudio) => {
      setLastTranscript(transcript);
      setLastAssessment(assessment ?? null);

      const { script, currentScriptIndex } = state;
      if (!script) return;
      const expectedTurn = script.turns[currentScriptIndex];
      if (!expectedTurn || expectedTurn.speaker !== "user") return;
      if (audio) saveUserRecording(currentScriptIndex, audio);
      const referenceText = getReferenceText(expectedTurn);
      const previousCoachLine = getPreviousCoachLine(script.turns, currentScriptIndex);
      const connectedSpeechGuide = flowGuides[getFlowGuideKey(referenceText, previousCoachLine)] ?? null;
      const isPracticeRepeat = mode === "practice" && state.pendingPassAdvance;
      // In practice mode the user produces freely; record how much scaffolding they needed.
      const scaffoldLevel = mode === "practice" ? hintTierRef.current : undefined;
      const hintsUsed = mode === "practice" ? hintTierRef.current : undefined;

      dispatch({ type: "EVALUATING", value: true });
      try {
        let pass: boolean;

        if (assessment) {
          // Assessment mode: Azure pronunciation result is authoritative
          pass = assessment.pass;
          await fetchCoachFeedback(referenceText, transcript, assessment, connectedSpeechGuide);
        } else {
          // Practice mode: semantic / lenient direction evaluation against the anchor
          const res = await fetch("/api/evaluate-line", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expected: expectedTurn.anchor?.sampleAnswer ?? referenceText,
              actual: transcript,
              ...(expectedTurn.anchor ? { anchor: expectedTurn.anchor } : {}),
            }),
          });
          const data = await res.json() as { pass: boolean };
          pass = data.pass;
          // Free-expression coaching: evaluate what the user actually said,
          // with the model answer only as reference.
          await fetchFreeCoachFeedback(
            transcript,
            previousCoachLine,
            expectedTurn.anchor?.sampleAnswer ?? referenceText
          );
        }

        if (isPracticeRepeat) {
          dispatch({ type: "PRACTICE_REPEAT_RESULT", passed: pass });
          return;
        }

        if (pass) {
          dispatch({ type: "PASS_HOLD", turnIndex: currentScriptIndex, scaffoldLevel, hintsUsed });
          if (passAdvanceTimeoutRef.current) clearTimeout(passAdvanceTimeoutRef.current);
          if (passAdvanceCountdownRef.current) clearInterval(passAdvanceCountdownRef.current);
          passAdvanceTimeoutRef.current = null;
          passAdvanceCountdownRef.current = null;
          return;
        }

        if (passAdvanceTimeoutRef.current) clearTimeout(passAdvanceTimeoutRef.current);
        if (passAdvanceCountdownRef.current) clearInterval(passAdvanceCountdownRef.current);
        passAdvanceTimeoutRef.current = null;
        passAdvanceCountdownRef.current = null;
        dispatch({ type: "EVAL_RESULT", passed: false, turnIndex: currentScriptIndex, scaffoldLevel, hintsUsed });
      } catch {
        // Fail-open: don't block the user on evaluation errors
        if (isPracticeRepeat) {
          dispatch({ type: "PRACTICE_REPEAT_RESULT", passed: true });
        } else {
          dispatch({ type: "EVAL_RESULT", passed: true, turnIndex: currentScriptIndex, scaffoldLevel, hintsUsed });
        }
      }
    },
    [fetchCoachFeedback, fetchFreeCoachFeedback, flowGuides, mode, saveUserRecording, state]
  );

  const handleNoSpeech = useCallback(() => {
    // Just reset — let user try again, don't count as attempt
  }, []);

  useEffect(() => {
    if (!state.script) return;

    const upcomingUserTurns = state.script.turns
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn, index }) => turn.speaker === "user" && index >= state.currentScriptIndex)
      .slice(0, state.stage === "warmup" ? 1 : 2);

    const timers = upcomingUserTurns.map(({ turn, index }, position) => (
      setTimeout(() => {
        prefetchFlowGuide(
          getReferenceText(turn),
          getPreviousCoachLine(state.script!.turns, index),
          index
        );
      }, (state.stage === "warmup" ? 1200 : 800) + position * 1500)
    ));

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [prefetchFlowGuide, state.currentScriptIndex, state.script, state.stage]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      clearSessionUiState();
      dispatch({ type: "CLEAR_FEEDBACK" });
      setHintTier(0);
      hintTierRef.current = 0;
    }, 0);
    return () => clearTimeout(timeout);
  }, [clearSessionUiState, state.currentScriptIndex]);

  const revealHint = useCallback(() => {
    setHintTier((current) => {
      const next = Math.min(2, current + 1);
      hintTierRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const recording of Object.values(userRecordingsRef.current)) {
        URL.revokeObjectURL(recording.url);
      }
      if (manualTtsFallbackRef.current) clearTimeout(manualTtsFallbackRef.current);
      manualTtsRef.current = null;
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (passAdvanceTimeoutRef.current) clearTimeout(passAdvanceTimeoutRef.current);
      if (passAdvanceCountdownRef.current) clearInterval(passAdvanceCountdownRef.current);
      if (flowGuideSaveTimeoutRef.current) clearTimeout(flowGuideSaveTimeoutRef.current);
    };
  }, []);

  // Helper: speak a line via TTS
  const speakLine = useCallback(async (text: string, source = "manual") => {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;

    if (synth?.speaking || synth?.pending) synth.cancel();
    if (manualTtsFallbackRef.current) clearTimeout(manualTtsFallbackRef.current);
    setPlayingTtsSource(source);

    let intentionalCancel = false;
    let started = false;
    let startFallback: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      manualTtsRef.current = null;
      if (manualTtsFallbackRef.current) clearTimeout(manualTtsFallbackRef.current);
      manualTtsFallbackRef.current = null;
      if (startFallback) clearTimeout(startFallback);
      startFallback = null;
      setPlayingTtsSource((current) => (current === source ? null : current));
    };

    try {
      await playServerSpeechAudio(text, "Samantha");
      finish();
      return;
    } catch (error) {
      console.warn("[TTS] server audio failed; falling back to browser voice", error);
    }

    if (!synth) {
      finish();
      return;
    }

    const voices = await waitForSpeechVoices();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    const enVoice = pickEnglishVoice(voices);
    if (enVoice) { utterance.voice = enVoice; utterance.lang = enVoice.lang; }
    if (DEBUG_TTS) console.log("[TTS] speaking with browser voice:", enVoice?.name, enVoice?.lang);
    manualTtsRef.current = utterance;
    utterance.onstart = () => {
      started = true;
      if (startFallback) clearTimeout(startFallback);
      startFallback = null;
      if (DEBUG_TTS) console.log("[TTS] onstart");
    };
    utterance.onend = finish;
    utterance.onerror = (e) => {
      if (intentionalCancel && e.error === "canceled") {
        return;
      }
      if (!started) {
        synth.cancel();
        finish();
      } else {
        console.error("[TTS] onerror", e.error);
        finish();
      }
    };
    const words = text.split(" ").length;
    const estimatedMs = Math.max(2500, words * 420);
    startFallback = setTimeout(() => {
      if (!started) {
        intentionalCancel = true;
        synth.cancel();
        finish();
      }
    }, 1200);
    manualTtsFallbackRef.current = setTimeout(() => {
      intentionalCancel = true;
      synth.cancel();
      finish();
    }, estimatedMs + 2000);
    try {
      synth.speak(utterance);
    } catch (error) {
      console.error("[TTS] speak failed", error);
      finish();
    }
  }, []);

  const handleTextSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = textInput.trim();
      if (!trimmed || state.evaluating || state.pendingPassAdvance) return;
      setTextInput("");
      handleTranscript(trimmed);
    },
    [textInput, state.evaluating, state.pendingPassAdvance, handleTranscript]
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  const { stage, script, elapsedSec, lastFeedback, attempt } = state;
  const canRepeatPractice = mode === "practice" && state.pendingPassAdvance;
  const remaining = Math.max(0, SESSION_MAX_SEC - elapsedSec);
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  if (stage === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500">Preparing your conversation…</p>
        </div>
      </div>
    );
  }

  if (stage === "warmup" && script) {
    const keywords = extractKeywords(script);
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full flex flex-col items-center gap-8 text-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 mb-2">
              {script.category}
            </p>
            <h1 className="text-2xl font-bold text-gray-900">{script.topic}</h1>
          </div>
          {keywords.length > 0 && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-gray-500">Key words for this conversation:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {keywords.map((kw) => (
                  <span key={kw} className="bg-blue-100 text-blue-700 text-sm font-medium px-3 py-1 rounded-full capitalize">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Mode selector */}
          <div className="w-full flex flex-col gap-2">
            <p className="text-sm text-gray-500 text-center">Practice mode</p>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 w-full">
              <button
                onClick={() => setMode("practice")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === "practice"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Practice
              </button>
              <button
                onClick={() => setMode("assessment")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === "assessment"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Assessment
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center">
              {mode === "practice"
                ? "Say it your own way — the coach checks your meaning, answer revealed after"
                : "Read the shown sentence — Azure scores your pronunciation"}
            </p>
          </div>

          <button
            onClick={() => dispatch({ type: "START_CONVERSATION" })}
            disabled={coachVoiceWarmup === "loading"}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-wait text-white font-semibold py-3 px-10 rounded-xl transition-colors text-lg"
          >
            {coachVoiceWarmup === "loading" ? "Preparing Voice..." : "I'm Ready"}
          </button>
        </div>
      </div>
    );
  }

  if ((stage === "conversation" || stage === "summarizing") && script) {
    const currentTurn = script.turns[state.currentScriptIndex];
    const isUserTurn = currentTurn?.speaker === "user";
    const previousCoachTurn = isUserTurn
      ? script.turns
          .slice(0, state.currentScriptIndex)
          .reverse()
          .find((turn) => turn.speaker === "coach")
      : null;
    const totalUserTurns = state.userTurnIndices.length;
    const progress = totalUserTurns > 0
      ? Math.round((state.currentUserTurnPos / totalUserTurns) * 100)
      : 0;
    const referenceText = isUserTurn ? getReferenceText(currentTurn) : "";
    const previousCoachLine = isUserTurn ? previousCoachTurn?.text ?? "" : "";
    const flowGuideKey = referenceText ? getFlowGuideKey(referenceText, previousCoachLine) : "";
    const currentFlowGuide = flowGuideKey ? flowGuides[flowGuideKey] : null;
    const flowGuideLoading = Boolean(flowGuideKey && flowGuideLoadingKeys[flowGuideKey]);

    // Produce-first (practice mode): hide the model answer until the user has spoken
    // or explicitly asked for it via the hint ladder. Assessment mode is a
    // pronunciation drill, so the reference stays visible throughout.
    const currentAnchor = isUserTurn ? currentTurn.anchor : undefined;
    const revealText = currentAnchor?.sampleAnswer ?? referenceText;
    const hasProduced = lastTranscript !== null;
    const showReference = mode === "assessment" || hasProduced || hintTier >= 2;
    const showScaffold = mode === "practice" && !hasProduced && Boolean(currentAnchor);
    // The model line's connected-speech guide only makes sense when the user is
    // reading that exact line (assessment). In free practice, coaching targets
    // the user's own sentence instead.
    const showFlowGuide = mode === "assessment";
    const referenceLabel = mode === "practice" && hasProduced ? "A natural way to say it:" : "You can say:";

    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-gray-400 uppercase tracking-wide">{script.category}</span>
            <span className="font-semibold text-gray-800 text-sm">{script.topic}</span>
          </div>
          {mode === "assessment" && (
            <div className="flex items-center gap-3">
              <span className={`font-mono text-sm font-bold ${remaining <= 60 ? "text-red-500" : "text-gray-600"}`}>
                {mm}:{ss}
              </span>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-1 bg-blue-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Conversation area */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6 max-w-lg mx-auto w-full">
          {currentTurn?.speaker === "coach" && stage !== "summarizing" && (
            <CoachLine
              key={state.currentScriptIndex}
              text={currentTurn.text}
              onDone={() => dispatch({ type: "COACH_DONE" })}
            />
          )}

          {isUserTurn && stage === "conversation" && (
            <div className="flex flex-col items-center gap-5 w-full">
              {previousCoachTurn && (
                <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100 w-full">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      A
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-blue-400 mb-1">Alex asked:</p>
                      <p className="text-gray-800 font-medium leading-relaxed">
                        {previousCoachTurn.text}
                      </p>
                    </div>
                    <button
                      onClick={() => speakLine(previousCoachTurn.text, "coach-question")}
                      disabled={Boolean(playingTtsSource)}
                      title="Hear Alex again"
                      className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-100 hover:bg-blue-200 disabled:bg-blue-50 text-blue-600 flex items-center justify-center transition-colors text-lg"
                    >
                      {playingTtsSource === "coach-question" ? (
                        <span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
                      ) : "🔊"}
                    </button>
                  </div>
                </div>
              )}

              {/* Produce-first scaffold (practice mode, before the user speaks) */}
              {showScaffold && currentAnchor && (
                <PromptScaffold anchor={currentAnchor} tier={hintTier} onHint={revealHint} />
              )}

              {/* Reference line with listen button (revealed after producing, or always in assessment) */}
              {showReference && (
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 w-full">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 text-center">
                      <p className="text-xs text-gray-400 mb-1">{referenceLabel}</p>
                      <p className="text-gray-800 font-medium leading-relaxed">
                        {revealText}
                      </p>
                    </div>
                    <button
                      onClick={() => speakLine(revealText, "reference-answer")}
                      disabled={Boolean(playingTtsSource)}
                      title="Hear it"
                      className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-100 hover:bg-blue-200 disabled:bg-blue-50 text-blue-600 flex items-center justify-center transition-colors text-lg"
                    >
                      {playingTtsSource === "reference-answer" ? (
                        <span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
                      ) : "🔊"}
                    </button>
                  </div>
                </div>
              )}

              {showFlowGuide && (currentFlowGuide || flowGuideLoading) && (
                <FlowGuide guide={currentFlowGuide} loading={flowGuideLoading} />
              )}

              {/* Feedback */}
              {lastFeedback && (
                <p className={`text-sm font-medium ${lastFeedback === "pass" ? "text-emerald-600" : "text-amber-600"}`}>
                  {lastFeedback === "pass"
                    ? state.pendingPassAdvance
                      ? canRepeatPractice
                        ? "✓ Great! Practice again, or continue when ready."
                        : "✓ Great! Review the feedback, then continue."
                      : "✓ Great!"
                    : attempt === 1
                    ? "Give it another try!"
                    : state.pendingPassAdvance
                    ? "Keep practicing, or continue when ready."
                    : "Moving on…"}
                </p>
              )}

              <MicButton
                onResult={handleTranscript}
                onNoSpeech={handleNoSpeech}
                disabled={state.evaluating || (state.pendingPassAdvance && mode !== "practice")}
                mode={mode}
                referenceText={referenceText}
              />

              {state.pendingPassAdvance && (
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: "ADVANCE_AFTER_PASS" });
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
                >
                  Continue
                </button>
              )}

              {lastTranscript && (
                <div className="w-full bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
                  <div>
                    <span className="text-xs text-blue-400 mr-1">You said:</span>
                    {lastTranscript}
                  </div>
                  {userRecordings[state.currentScriptIndex] && (
                    <div className="mt-3">
                      <audio
                        controls
                        src={userRecordings[state.currentScriptIndex].url}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>
              )}

              {mode === "assessment" && lastAssessment && (
                <div className="w-full flex flex-col gap-2">
                  <div className="w-full grid grid-cols-4 gap-2 text-center">
                    {([
                      ["Pron.", lastAssessment.pronunciationScore],
                      ["Accuracy", lastAssessment.accuracyScore],
                      ["Fluency", lastAssessment.fluencyScore],
                      ["Complete", lastAssessment.completenessScore],
                    ] as [string, number][]).map(([label, score]) => (
                      <div
                        key={label}
                        className={`rounded-xl border px-2 py-2 ${
                          score >= 80
                            ? "border-emerald-200 bg-emerald-50"
                            : score >= 60
                            ? "border-amber-200 bg-amber-50"
                            : "border-red-200 bg-red-50"
                        }`}
                      >
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
                        <div className={`text-sm font-bold ${
                          score >= 80 ? "text-emerald-700" : score >= 60 ? "text-amber-700" : "text-red-700"
                        }`}>{score}</div>
                      </div>
                    ))}
                  </div>
                  {lastAssessment.words && lastAssessment.words.some((w) => w.errorType && w.errorType !== "None") && (
                    <div className="w-full flex flex-wrap gap-1">
                      {lastAssessment.words
                        .filter((w) => w.errorType && w.errorType !== "None")
                        .map((w, i) => (
                          <span
                            key={i}
                            className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5"
                            title={w.errorType}
                          >
                            {w.word}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {(coachFeedbackLoading || coachFeedback) && (
                <div className="w-full rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400">
                      AI Coach
                    </p>
                    {coachFeedbackLoading && (
                      <span className="w-4 h-4 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>

                  {coachFeedback ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <p className="text-sm text-gray-800">{coachFeedback.summary}</p>
                      <div className="flex flex-col gap-2">
                        {coachFeedback.tips.map((tip, index) => (
                          <div key={`${tip.type}-${index}`} className="rounded-xl bg-white/80 px-3 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
                              {tip.type === "pronunciation" ? "Pronunciation" : "Naturalness"}
                              {tip.target ? ` · ${tip.target}` : ""}
                            </p>
                            <p className="mt-1 text-sm leading-5 text-gray-700">{tip.advice}</p>
                            {(() => {
                              const key = `${state.currentScriptIndex}-${index}`;
                              const practiceText = getTipPracticeText(tip, coachFeedback.retryPrompt);
                              const practiceResult = tipPracticeResults[key];

                              return (
                                <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-3">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
                                        Follow-up practice
                                      </p>
                                      <p className="mt-1 text-sm font-medium leading-5 text-gray-800">
                                        {practiceText}
                                      </p>
                                    </div>
                                    <div className="sm:w-24">
                                      <MicButton
                                        onResult={(transcript, assessment) =>
                                          handleTipPracticeResult(key, practiceText, transcript, assessment)
                                        }
                                        onNoSpeech={() => {}}
                                        disabled={false}
                                        mode={mode}
                                        referenceText={practiceText}
                                        variant="compact"
                                      />
                                    </div>
                                  </div>

                                  {practiceResult && (
                                    <div className="mt-3 flex flex-col gap-2 border-t border-indigo-100 pt-3">
                                      {practiceResult.assessment && (
                                        <div className="grid grid-cols-4 gap-2 text-center">
                                          {([
                                            ["Pron.", practiceResult.assessment.pronunciationScore],
                                            ["Acc.", practiceResult.assessment.accuracyScore],
                                            ["Flu.", practiceResult.assessment.fluencyScore],
                                            ["Comp.", practiceResult.assessment.completenessScore],
                                          ] as [string, number][]).map(([label, score]) => (
                                            <div key={label} className="rounded-lg bg-white px-2 py-1">
                                              <div className="text-[9px] uppercase text-gray-400">{label}</div>
                                              <div className={`text-xs font-bold ${
                                                score >= 80 ? "text-emerald-700" : score >= 60 ? "text-amber-700" : "text-red-700"
                                              }`}>{score}</div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      <p className="text-xs text-gray-500">
                                        You said: {practiceResult.transcript || "No transcript"}
                                      </p>
                                      {practiceResult.loading && (
                                        <p className="text-xs text-indigo-500">Checking how to improve this practice...</p>
                                      )}
                                      {practiceResult.feedback && (
                                        <div className="rounded-lg bg-white px-3 py-2">
                                          <p className="text-xs font-medium text-gray-700">
                                            {practiceResult.feedback.summary}
                                          </p>
                                          {practiceResult.feedback.tips[0] && (
                                            <p className="mt-1 text-xs text-gray-600">
                                              {practiceResult.feedback.tips[0].advice}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-indigo-600">{coachFeedback.retryPrompt}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-indigo-600">Thinking about your pronunciation...</p>
                  )}
                </div>
              )}

              {/* Speed round (practice mode, after the model answer is revealed) */}
              {mode === "practice" && hasProduced && revealText && (
                <SpeedRound
                  key={state.currentScriptIndex}
                  targetText={revealText}
                  firstAttempt={
                    userRecordings[state.currentScriptIndex]
                      ? {
                          url: userRecordings[state.currentScriptIndex].url,
                          durationMs: userRecordings[state.currentScriptIndex].durationMs,
                        }
                      : undefined
                  }
                />
              )}

              {/* Text input fallback */}
              <form onSubmit={handleTextSubmit} className="flex w-full gap-2 mt-1">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  disabled={state.evaluating || (state.pendingPassAdvance && mode !== "practice")}
                  placeholder="Or type your answer here…"
                  className="flex-1 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100 disabled:text-gray-400"
                />
                <button
                  type="submit"
                  disabled={state.evaluating || (state.pendingPassAdvance && mode !== "practice") || !textInput.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
                >
                  Send
                </button>
              </form>
            </div>
          )}

          {stage === "summarizing" && (
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-500">Generating your feedback…</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (stage === "summary" && script) {
    const totalLines = state.userTurnIndices.length;
    const passedLines = state.results.filter((r) => r.passed).length;
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12">
        <div className="max-w-lg w-full flex flex-col gap-8">
          <h2 className="text-2xl font-bold text-gray-900 text-center">Session Complete 🎉</h2>
          <SessionSummary
            summary={state.summary}
            passedLines={passedLines}
            totalLines={totalLines}
            script={script}
            userRecordings={userRecordings}
            playingTtsSource={playingTtsSource}
            onPlayCoach={(text, source) => speakLine(text, source)}
            onNext={() => {
              clearSessionUiState();
              clearConversationReplay();
              dispatch({ type: "RESET" });
              loadNextScript();
            }}
            onDone={() => {
              clearConversationReplay();
              router.push("/");
            }}
          />
        </div>
      </div>
    );
  }

  return null;
}
