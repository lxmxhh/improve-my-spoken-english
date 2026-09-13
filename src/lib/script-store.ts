import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  getBuiltinScripts,
  getScriptKey,
  isValidScript,
  MAX_GENERATED_VARIANTS_PER_TOPIC,
  SCRIPT_CATEGORIES,
} from "./script-pool";
import type { Script } from "./types";

export { getScriptKey };

/**
 * Two-tier script storage:
 *  - seed  (data/script-seed.json, git-tracked): the curated base library shipped with the code.
 *  - pool  (data/script-pool.json, git-ignored): everything written at runtime — AI refills,
 *          field enrichment (anchors, flow guides) and admin edits. A runtime entry with the
 *          same key as a seed script overrides it; the seed file is never written by the app.
 */
export type ScriptPool = Partial<Record<string, Script[]>>;
export type ScriptSource = "seed" | "cached" | "builtin";

export interface ScriptRecord {
  key: string;
  source: ScriptSource;
  script: Script;
}

const SEED_PATH = process.env.SCRIPT_SEED_PATH ?? join(process.cwd(), "data", "script-seed.json");
const POOL_PATH = process.env.SCRIPT_POOL_PATH ?? join(process.cwd(), "data", "script-pool.json");
const MAX_CACHED_PER_CATEGORY = 25;

function topicKey(topic: string) {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}

async function readScriptFile(path: string): Promise<ScriptPool> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const pool: ScriptPool = {};
    for (const [category, scripts] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(scripts)) continue;
      pool[category] = scripts.filter(isValidScript);
    }
    return pool;
  } catch {
    return {};
  }
}

export function readSeedPool(): Promise<ScriptPool> {
  return readScriptFile(SEED_PATH);
}

export function readRuntimePool(): Promise<ScriptPool> {
  return readScriptFile(POOL_PATH);
}

export function mergePools(seed: ScriptPool, runtime: ScriptPool): ScriptPool {
  const merged: ScriptPool = {};
  for (const category of SCRIPT_CATEGORIES) {
    const overrides = new Map(
      (runtime[category] ?? []).filter(isValidScript).map((script) => [getScriptKey(script), script])
    );
    const seen = new Set<string>();
    const scripts: Script[] = [];

    for (const script of (seed[category] ?? []).filter(isValidScript)) {
      const key = getScriptKey(script);
      if (seen.has(key)) continue;
      seen.add(key);
      scripts.push(overrides.get(key) ?? script);
    }
    for (const [key, script] of overrides) {
      if (seen.has(key)) continue;
      seen.add(key);
      scripts.push(script);
    }

    if (scripts.length > 0) merged[category] = scripts;
  }
  return merged;
}

export async function readMergedPool(): Promise<ScriptPool> {
  const [seed, runtime] = await Promise.all([readSeedPool(), readRuntimePool()]);
  return mergePools(seed, runtime);
}

function trimPool(pool: ScriptPool): ScriptPool {
  const trimmed: ScriptPool = {};
  for (const category of SCRIPT_CATEGORIES) {
    const scripts = (pool[category] ?? []).filter(isValidScript);
    trimmed[category] = scripts.slice(-MAX_CACHED_PER_CATEGORY);
  }
  return trimmed;
}

async function writeRuntimePool(pool: ScriptPool) {
  await mkdir(dirname(POOL_PATH), { recursive: true });
  await writeFile(POOL_PATH, `${JSON.stringify(trimPool(pool), null, 2)}\n`, "utf8");
}

export function getRecords(seed: ScriptPool, runtime: ScriptPool): ScriptRecord[] {
  const records: ScriptRecord[] = [];
  const seen = new Set<string>();
  const merged = mergePools(seed, runtime);
  const seedKeys = new Set(
    SCRIPT_CATEGORIES.flatMap((category) => (seed[category] ?? []).map(getScriptKey))
  );

  for (const category of SCRIPT_CATEGORIES) {
    for (const script of merged[category] ?? []) {
      const key = getScriptKey(script);
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({ key, source: seedKeys.has(key) ? "seed" : "cached", script });
    }
  }

  for (const script of getBuiltinScripts()) {
    const key = getScriptKey(script);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({ key, source: "builtin", script });
  }

  return records;
}

export async function getAllRecords(): Promise<ScriptRecord[]> {
  const [seed, runtime] = await Promise.all([readSeedPool(), readRuntimePool()]);
  return getRecords(seed, runtime);
}

/** Append AI-generated scripts to the runtime pool, deduping against seed + runtime. */
export async function addGeneratedScripts(category: string, scripts: Script[]): Promise<ScriptRecord[]> {
  const validScripts = scripts.filter((script) => isValidScript(script) && script.category === category);
  const [seed, runtime] = await Promise.all([readSeedPool(), readRuntimePool()]);
  if (validScripts.length === 0) return getRecords(seed, runtime);

  const existing = mergePools(seed, runtime)[category] ?? [];
  const seen = new Set(existing.map(getScriptKey));
  const topicCounts = new Map<string, number>();
  for (const script of existing) {
    const key = topicKey(script.topic);
    topicCounts.set(key, (topicCounts.get(key) ?? 0) + 1);
  }

  const added: Script[] = [];
  for (const script of validScripts) {
    const key = getScriptKey(script);
    if (seen.has(key)) continue;
    const currentTopicKey = topicKey(script.topic);
    if ((topicCounts.get(currentTopicKey) ?? 0) >= MAX_GENERATED_VARIANTS_PER_TOPIC) continue;

    seen.add(key);
    topicCounts.set(currentTopicKey, (topicCounts.get(currentTopicKey) ?? 0) + 1);
    added.push(script);
  }

  const nextRuntime: ScriptPool = {
    ...runtime,
    [category]: [...(runtime[category] ?? []).filter(isValidScript), ...added],
  };
  await writeRuntimePool(nextRuntime);
  return getRecords(seed, nextRuntime);
}

/**
 * Store a script in the runtime pool. If it replaces a runtime script (previousKey), that
 * one is removed; a same-key entry for a seed script acts as an override of the seed.
 */
export async function upsertScript(previousKey: string | null, script: Script): Promise<ScriptRecord[]> {
  const [seed, runtime] = await Promise.all([readSeedPool(), readRuntimePool()]);
  const nextKey = getScriptKey(script);
  const nextRuntime: ScriptPool = {};

  for (const category of SCRIPT_CATEGORIES) {
    const existing = (runtime[category] ?? []).filter(isValidScript);
    nextRuntime[category] = existing.filter((item) => {
      const key = getScriptKey(item);
      return key !== previousKey && key !== nextKey;
    });
  }

  nextRuntime[script.category] = [...(nextRuntime[script.category] ?? []), script];
  await writeRuntimePool(nextRuntime);
  return getRecords(seed, nextRuntime);
}

/** Remove a runtime script. Seed scripts are read-only here; edit the seed file instead. */
export async function deleteScript(key: string): Promise<ScriptRecord[]> {
  const [seed, runtime] = await Promise.all([readSeedPool(), readRuntimePool()]);
  const nextRuntime: ScriptPool = {};

  for (const category of SCRIPT_CATEGORIES) {
    const existing = (runtime[category] ?? []).filter(isValidScript);
    nextRuntime[category] = existing.filter((script) => getScriptKey(script) !== key);
  }

  await writeRuntimePool(nextRuntime);
  return getRecords(seed, nextRuntime);
}
