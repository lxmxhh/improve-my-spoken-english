import FALLBACK_SCRIPTS from "./fallback-scripts";
import type { Script, ScriptTurn } from "./types";

export const SCRIPT_CATEGORIES = [
  "Daily Life",
  "Work & Career",
  "News & Society",
  "Entertainment & Culture",
] as const;

const CACHE_KEY = "esp_script_pool_v1";
const PERFORMANCE_KEY = "esp_script_performance_v1";
const MAX_CACHED_PER_CATEGORY = 25;
const REFILL_TARGET_PER_CATEGORY = 25;
const REFILL_BATCH_SIZE = 3;
const REVIEW_PROBABILITY = 0.35;
const LOW_SCORE_THRESHOLD = 0.8;

const BUILTIN_SCRIPTS: Script[] = [
  ...FALLBACK_SCRIPTS,
  {
    topic: "Ordering Coffee",
    category: "Daily Life",
    turns: [
      { speaker: "coach", text: "Let's practice ordering coffee. What would you like today?" },
      { speaker: "user", text: "I would like a medium latte with oat milk, please." },
      { speaker: "coach", text: "Great choice. Would you like it hot or iced?" },
      { speaker: "user", text: "I would like it hot, but not too sweet." },
      { speaker: "coach", text: "Sure. Do you want anything to eat with that?" },
      { speaker: "user", text: "Yes, I will also take a blueberry muffin." },
      { speaker: "coach", text: "Perfect. Is this for here or to go?" },
      { speaker: "user", text: "It is to go, because I am late for work." },
    ],
  },
  {
    topic: "Asking for Directions",
    category: "Daily Life",
    turns: [
      { speaker: "coach", text: "Let's practice directions. Where are you trying to go?" },
      { speaker: "user", text: "I am trying to find the nearest subway station." },
      { speaker: "coach", text: "You are close. Walk straight for two blocks first." },
      { speaker: "user", text: "Should I turn left at the traffic light?" },
      { speaker: "coach", text: "Yes, then you will see the entrance beside a bank." },
      { speaker: "user", text: "Thank you. Is it about five minutes from here?" },
      { speaker: "coach", text: "Exactly. It is a short and easy walk." },
      { speaker: "user", text: "Great, I think I can find it now." },
    ],
  },
  {
    topic: "A Team Meeting",
    category: "Work & Career",
    turns: [
      { speaker: "coach", text: "Let's talk about meetings. How was your team meeting today?" },
      { speaker: "user", text: "It was productive, but we had many topics to discuss." },
      { speaker: "coach", text: "What was the most important decision from the meeting?" },
      { speaker: "user", text: "We decided to delay the launch by one week." },
      { speaker: "coach", text: "That sounds reasonable. Why did the team choose that?" },
      { speaker: "user", text: "We need more time to test the payment feature." },
      { speaker: "coach", text: "How did people react to the new timeline?" },
      { speaker: "user", text: "Most people agreed, because quality matters more than speed." },
    ],
  },
  {
    topic: "Giving Feedback",
    category: "Work & Career",
    turns: [
      { speaker: "coach", text: "Let's practice workplace feedback. What do you want to say?" },
      { speaker: "user", text: "I want to give feedback in a polite way." },
      { speaker: "coach", text: "Good goal. What did your colleague do well?" },
      { speaker: "user", text: "She explained the problem clearly and stayed very calm." },
      { speaker: "coach", text: "Nice. What could be improved next time?" },
      { speaker: "user", text: "The report could include more details about the timeline." },
      { speaker: "coach", text: "That is specific and helpful. How will you end?" },
      { speaker: "user", text: "I will thank her and offer to help if needed." },
    ],
  },
  {
    topic: "Public Transport Changes",
    category: "News & Society",
    turns: [
      { speaker: "coach", text: "Let's discuss city news. Did you hear about the transport changes?" },
      { speaker: "user", text: "Yes, the city plans to add more electric buses." },
      { speaker: "coach", text: "Interesting. Why do you think they are doing that?" },
      { speaker: "user", text: "They want to reduce air pollution and traffic noise." },
      { speaker: "coach", text: "That could help many residents. Are there any concerns?" },
      { speaker: "user", text: "Some people worry the ticket prices may increase." },
      { speaker: "coach", text: "That is a fair concern. What is your opinion?" },
      { speaker: "user", text: "I support the plan if public transport stays affordable." },
    ],
  },
  {
    topic: "Online Privacy",
    category: "News & Society",
    turns: [
      { speaker: "coach", text: "Let's talk about online privacy. Is it important to you?" },
      { speaker: "user", text: "Yes, I think people should control their personal data." },
      { speaker: "coach", text: "What kind of data worries you the most?" },
      { speaker: "user", text: "I worry about location history and private messages." },
      { speaker: "coach", text: "That makes sense. How do you protect yourself online?" },
      { speaker: "user", text: "I use strong passwords and avoid suspicious links." },
      { speaker: "coach", text: "Good habits. Should companies follow stricter rules?" },
      { speaker: "user", text: "Definitely. They should explain clearly how data is used." },
    ],
  },
  {
    topic: "A Music Festival",
    category: "Entertainment & Culture",
    turns: [
      { speaker: "coach", text: "Let's talk about music. Have you ever been to a festival?" },
      { speaker: "user", text: "Yes, I went to a small music festival last summer." },
      { speaker: "coach", text: "That sounds exciting. What kind of music did they play?" },
      { speaker: "user", text: "They played indie rock, electronic music, and some jazz." },
      { speaker: "coach", text: "Nice mix. What was your favorite moment there?" },
      { speaker: "user", text: "My favorite moment was singing with the crowd at night." },
      { speaker: "coach", text: "Would you go to a larger festival next time?" },
      { speaker: "user", text: "Maybe, but I prefer smaller events with fewer people." },
    ],
  },
  {
    topic: "Visiting a Museum",
    category: "Entertainment & Culture",
    turns: [
      { speaker: "coach", text: "Let's discuss culture. Do you enjoy visiting museums?" },
      { speaker: "user", text: "Yes, museums help me understand history and art better." },
      { speaker: "coach", text: "What kind of museum do you like most?" },
      { speaker: "user", text: "I like science museums because they feel interactive and fun." },
      { speaker: "coach", text: "That is a good reason. Did you visit one recently?" },
      { speaker: "user", text: "Yes, I saw an exhibition about space exploration." },
      { speaker: "coach", text: "What did you learn from that exhibition?" },
      { speaker: "user", text: "I learned how difficult it is to live in space." },
    ],
  },
];

type ScriptPool = Partial<Record<string, Script[]>>;

interface ScriptPerformance {
  attempts: number;
  scoreAvg: number;
  lastScore: number;
  lastPracticedAt: number;
  dueAfterMs: number;
}

type PerformanceMap = Record<string, ScriptPerformance>;

let refillInFlight = false;

function readPool(): ScriptPool {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const pool: ScriptPool = {};
    for (const [category, scripts] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(scripts)) continue;
      pool[category] = scripts.filter(isScript);
    }
    return pool;
  } catch {
    return {};
  }
}

function writePool(pool: ScriptPool) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(trimPool(pool)));
  } catch {
    // Ignore storage quota or private browsing failures.
  }
}

function readPerformance(): PerformanceMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(PERFORMANCE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as PerformanceMap;
  } catch {
    return {};
  }
}

function writePerformance(performance: PerformanceMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PERFORMANCE_KEY, JSON.stringify(performance));
  } catch {
    // Ignore storage quota or private browsing failures.
  }
}

function isTurn(value: unknown): value is ScriptTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Partial<ScriptTurn>;
  return (
    (turn.speaker === "coach" || turn.speaker === "user") &&
    typeof turn.text === "string" &&
    turn.text.trim().length > 0
  );
}

function isScript(value: unknown): value is Script {
  if (!value || typeof value !== "object") return false;
  const script = value as Partial<Script>;
  return (
    typeof script.topic === "string" &&
    typeof script.category === "string" &&
    Array.isArray(script.turns) &&
    script.turns.length >= 6 &&
    script.turns.every(isTurn)
  );
}

function scriptKey(script: Script) {
  return `${script.category}::${script.topic}::${script.turns.map((turn) => turn.text).join("|")}`;
}

function trimPool(pool: ScriptPool): ScriptPool {
  const trimmed: ScriptPool = {};
  for (const category of SCRIPT_CATEGORIES) {
    const scripts = (pool[category] ?? []).filter(isScript);
    trimmed[category] = scripts.slice(-MAX_CACHED_PER_CATEGORY);
  }
  return trimmed;
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function getCachedScripts(category: string): Script[] {
  return (readPool()[category] ?? []).filter(isScript);
}

function getCategoryScripts(category: string): Script[] {
  const pool = readPool();
  const cached = (pool[category] ?? []).filter(isScript);
  const builtin = BUILTIN_SCRIPTS.filter((script) => script.category === category);
  const merged: Script[] = [];
  const seen = new Set<string>();

  for (const script of [...cached, ...builtin]) {
    const key = scriptKey(script);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(script);
  }

  return merged;
}

function getReviewScript(category: string, candidates: Script[]): Script | null {
  if (Math.random() > REVIEW_PROBABILITY) return null;

  const now = Date.now();
  const performance = readPerformance();
  const candidateKeys = new Set(candidates.map(scriptKey));
  let pruned = false;

  for (const key of Object.keys(performance)) {
    if (key.startsWith(`${category}::`) && !candidateKeys.has(key)) {
      delete performance[key];
      pruned = true;
    }
  }

  if (pruned) writePerformance(performance);

  const due = candidates
    .map((script) => ({ script, stats: performance[scriptKey(script)] }))
    .filter(({ stats }) => (
      stats &&
      stats.attempts > 0 &&
      stats.scoreAvg < LOW_SCORE_THRESHOLD &&
      now - stats.lastPracticedAt >= stats.dueAfterMs
    ))
    .sort((a, b) => a.stats.scoreAvg - b.stats.scoreAvg);

  return due[0]?.script ?? null;
}

export function getImmediateScript(category: string): Script {
  const candidates = getCategoryScripts(category);
  const reviewScript = getReviewScript(category, candidates);
  if (reviewScript) return reviewScript;

  return randomItem(candidates.length > 0 ? candidates : BUILTIN_SCRIPTS);
}

export function getCachedScriptCount(category: string): number {
  return getCachedScripts(category).length;
}

export function addCachedScripts(category: string, scripts: Script[]) {
  const validScripts = scripts.filter((script) => isScript(script) && script.category === category);
  if (validScripts.length === 0) return;

  const pool = readPool();
  const existing = (pool[category] ?? []).filter(isScript);
  const seen = new Set(existing.map(scriptKey));
  const merged = [...existing];

  for (const script of validScripts) {
    const key = scriptKey(script);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(script);
  }

  pool[category] = merged.slice(-MAX_CACHED_PER_CATEGORY);
  writePool(pool);
}

export function recordScriptPerformance(script: Script, passedLines: number, totalLines: number) {
  if (typeof window === "undefined" || totalLines <= 0) return;

  const score = Math.max(0, Math.min(1, passedLines / totalLines));
  const performance = readPerformance();
  const key = scriptKey(script);
  const previous = performance[key];
  const scoreAvg = previous ? previous.scoreAvg * 0.7 + score * 0.3 : score;

  performance[key] = {
    attempts: (previous?.attempts ?? 0) + 1,
    scoreAvg,
    lastScore: score,
    lastPracticedAt: Date.now(),
    dueAfterMs: getReviewDelayMs(score),
  };
  writePerformance(performance);
}

function getReviewDelayMs(score: number) {
  const day = 24 * 60 * 60 * 1000;
  if (score < 0.5) return day;
  if (score < 0.8) return 3 * day;
  return 7 * day;
}

export async function refillScriptPool(category: string, targetCount = REFILL_TARGET_PER_CATEGORY) {
  if (typeof window === "undefined" || refillInFlight) return;

  const currentCount = getCachedScriptCount(category);
  const needed = Math.min(REFILL_BATCH_SIZE, Math.max(0, targetCount - currentCount));
  if (needed === 0) return;

  refillInFlight = true;
  try {
    const generated: Script[] = [];
    for (let i = 0; i < needed; i += 1) {
      const response = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      if (!response.ok) continue;
      const script = await response.json() as unknown;
      if (isScript(script)) generated.push(script);
    }
    addCachedScripts(category, generated);
  } catch (error) {
    console.warn("[script-pool] refill failed:", error);
  } finally {
    refillInFlight = false;
  }
}
