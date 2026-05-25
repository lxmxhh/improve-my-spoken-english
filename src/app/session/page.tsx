"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import CoachLine from "@/components/CoachLine";
import MicButton from "@/components/MicButton";
import SessionSummary from "@/components/SessionSummary";
import FALLBACK_SCRIPTS from "@/lib/fallback-scripts";
import { saveSession, computeAndUpdateStreak } from "@/lib/storage";
import type { Script, ScriptTurn, TurnResult } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "loading" | "warmup" | "conversation" | "summarizing" | "summary";

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
}

type Action =
  | { type: "SCRIPT_LOADED"; script: Script }
  | { type: "START_CONVERSATION" }
  | { type: "COACH_DONE" }
  | { type: "EVAL_RESULT"; passed: boolean; turnIndex: number }
  | { type: "EVALUATING"; value: boolean }
  | { type: "TICK" }
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

const CATEGORIES = ["Daily Life", "Work & Career", "News & Society", "Entertainment & Culture"];
const SESSION_MAX_SEC = 300;

// ─── Reducer ──────────────────────────────────────────────────────────────────

const initial: State = {
  stage: "loading",
  script: null,
  userTurnIndices: [],
  currentUserTurnPos: 0,
  currentScriptIndex: 0,
  attempt: 0,
  results: [],
  elapsedSec: 0,
  evaluating: false,
  summary: "",
  lastFeedback: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SCRIPT_LOADED": {
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
    case "EVAL_RESULT": {
      const turns = state.script!.turns;
      if (action.passed || state.attempt === 1) {
        // Advance to next turn
        const result: TurnResult = {
          turnIndex: action.turnIndex,
          passed: action.passed,
        };
        const results = [...state.results, result];
        let next = state.currentScriptIndex + 1;
        // Skip any leading coach turns — they'll render via COACH_DONE
        // (actually coach turns render themselves; we just advance index)
        if (next >= turns.length) {
          return { ...state, results, stage: "summarizing", evaluating: false, lastFeedback: action.passed ? "pass" : "fail" };
        }
        return {
          ...state,
          results,
          currentScriptIndex: next,
          currentUserTurnPos: state.currentUserTurnPos + 1,
          attempt: 0,
          evaluating: false,
          lastFeedback: action.passed ? "pass" : "fail",
        };
      } else {
        // First attempt failed — allow retry
        return { ...state, attempt: 1, evaluating: false, lastFeedback: "fail" };
      }
    }
    case "TICK": {
      const elapsed = state.elapsedSec + 1;
      if (elapsed >= SESSION_MAX_SEC && state.stage === "conversation") {
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
  const summarizingRef = useRef(false);

  // Load script on mount
  useEffect(() => {
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    fetch("/api/generate-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    })
      .then((r) => r.json())
      .then((script: Script) => dispatch({ type: "SCRIPT_LOADED", script }))
      .catch(() => {
        const fallback = FALLBACK_SCRIPTS[Math.floor(Math.random() * FALLBACK_SCRIPTS.length)];
        dispatch({ type: "SCRIPT_LOADED", script: fallback });
      });
  }, []);

  // Timer during conversation
  useEffect(() => {
    if (state.stage === "conversation") {
      timerRef.current = setInterval(() => dispatch({ type: "TICK" }), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.stage]);

  // Trigger summary generation
  const runSummarize = useCallback(async () => {
    if (summarizingRef.current || !state.script) return;
    summarizingRef.current = true;

    const totalLines = state.userTurnIndices.length;
    const passedLines = state.results.filter((r) => r.passed).length;

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
    };

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: state.script, passedLines, totalLines }),
      });
      const { summary } = await res.json();
      session.summary = summary;
      dispatch({ type: "SUMMARY_READY", summary });
    } catch {
      session.summary = "Great job! Keep practicing every day!";
      dispatch({ type: "SUMMARY_READY", summary: session.summary });
    }

    saveSession(session);
    computeAndUpdateStreak(session.id);
  }, [state.script, state.userTurnIndices, state.results, state.elapsedSec]);

  useEffect(() => {
    if (state.stage === "summarizing") {
      runSummarize();
    }
  }, [state.stage, runSummarize]);

  // Evaluate user speech
  const handleTranscript = useCallback(
    async (transcript: string) => {
      const { script, currentScriptIndex, attempt } = state;
      if (!script) return;
      const expectedTurn = script.turns[currentScriptIndex];
      if (!expectedTurn || expectedTurn.speaker !== "user") return;

      dispatch({ type: "EVALUATING", value: true });
      try {
        const res = await fetch("/api/evaluate-line", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expected: expectedTurn.text, actual: transcript }),
        });
        const { pass } = await res.json();
        dispatch({ type: "EVAL_RESULT", passed: pass, turnIndex: currentScriptIndex });
      } catch {
        // Fail-open
        dispatch({ type: "EVAL_RESULT", passed: true, turnIndex: currentScriptIndex });
      }
    },
    [state]
  );

  const handleNoSpeech = useCallback(() => {
    // Just reset — let user try again, don't count as attempt
  }, []);

  const [textInput, setTextInput] = useState("");

  const handleTextSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = textInput.trim();
      if (!trimmed || state.evaluating) return;
      setTextInput("");
      handleTranscript(trimmed);
    },
    [textInput, state.evaluating, handleTranscript]
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  const { stage, script, elapsedSec, lastFeedback, attempt } = state;
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
          <button
            onClick={() => dispatch({ type: "START_CONVERSATION" })}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-10 rounded-xl transition-colors text-lg"
          >
            I&apos;m Ready
          </button>
        </div>
      </div>
    );
  }

  if ((stage === "conversation" || stage === "summarizing") && script) {
    const currentTurn = script.turns[state.currentScriptIndex];
    const isUserTurn = currentTurn?.speaker === "user";
    const totalUserTurns = state.userTurnIndices.length;
    const progress = totalUserTurns > 0
      ? Math.round((state.currentUserTurnPos / totalUserTurns) * 100)
      : 0;

    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-gray-400 uppercase tracking-wide">{script.category}</span>
            <span className="font-semibold text-gray-800 text-sm">{script.topic}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`font-mono text-sm font-bold ${remaining <= 60 ? "text-red-500" : "text-gray-600"}`}>
              {mm}:{ss}
            </span>
          </div>
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
              {/* Reference line */}
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 w-full text-center">
                <p className="text-xs text-gray-400 mb-1">You can say:</p>
                <p className="text-gray-800 font-medium leading-relaxed">
                  {currentTurn.hint ?? currentTurn.text}
                </p>
              </div>

              {/* Feedback */}
              {lastFeedback && (
                <p className={`text-sm font-medium ${lastFeedback === "pass" ? "text-emerald-600" : "text-amber-600"}`}>
                  {lastFeedback === "pass"
                    ? "✓ Great!"
                    : attempt === 1
                    ? "Give it another try!"
                    : "Moving on…"}
                </p>
              )}

              <MicButton
                onResult={handleTranscript}
                onNoSpeech={handleNoSpeech}
                disabled={state.evaluating}
              />

              {/* Text input fallback for testing */}
              <form onSubmit={handleTextSubmit} className="flex w-full gap-2 mt-1">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  disabled={state.evaluating}
                  placeholder="Or type your answer here…"
                  className="flex-1 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100 disabled:text-gray-400"
                />
                <button
                  type="submit"
                  disabled={state.evaluating || !textInput.trim()}
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
            onNext={() => {
              dispatch({ type: "RESET" });
            }}
            onDone={() => router.push("/")}
          />
        </div>
      </div>
    );
  }

  return null;
}
