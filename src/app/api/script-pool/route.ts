import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  getBuiltinScripts,
  getScriptKey,
  isValidScript,
  MAX_GENERATED_VARIANTS_PER_TOPIC,
  SCRIPT_CATEGORIES,
} from "@/lib/script-pool";
import type { Script } from "@/lib/types";

type ScriptPool = Partial<Record<string, Script[]>>;

const MAX_CACHED_PER_CATEGORY = 25;
const STORE_PATH = join(process.cwd(), "data", "script-pool.json");

function topicKey(topic: string) {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}

async function readPool(): Promise<ScriptPool> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
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

function trimPool(pool: ScriptPool): ScriptPool {
  const trimmed: ScriptPool = {};
  for (const category of SCRIPT_CATEGORIES) {
    const scripts = (pool[category] ?? []).filter(isValidScript);
    trimmed[category] = scripts.slice(-MAX_CACHED_PER_CATEGORY);
  }
  return trimmed;
}

async function writePool(pool: ScriptPool) {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(trimPool(pool), null, 2)}\n`, "utf8");
}

function getRecords(pool: ScriptPool) {
  const records: { key: string; source: "builtin" | "cached"; script: Script }[] = [];
  const seen = new Set<string>();

  for (const category of SCRIPT_CATEGORIES) {
    for (const script of (pool[category] ?? []).filter(isValidScript)) {
      const key = getScriptKey(script);
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({ key, source: "cached", script });
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

function addGeneratedScripts(pool: ScriptPool, category: string, scripts: Script[]) {
  const validScripts = scripts.filter((script) => isValidScript(script) && script.category === category);
  if (validScripts.length === 0) return pool;

  const existing = (pool[category] ?? []).filter(isValidScript);
  const seen = new Set(existing.map(getScriptKey));
  const merged = [...existing];
  const topicCounts = new Map<string, number>();

  for (const script of existing) {
    const key = topicKey(script.topic);
    topicCounts.set(key, (topicCounts.get(key) ?? 0) + 1);
  }

  for (const script of validScripts) {
    const key = getScriptKey(script);
    if (seen.has(key)) continue;

    const currentTopicKey = topicKey(script.topic);
    if ((topicCounts.get(currentTopicKey) ?? 0) >= MAX_GENERATED_VARIANTS_PER_TOPIC) continue;

    seen.add(key);
    topicCounts.set(currentTopicKey, (topicCounts.get(currentTopicKey) ?? 0) + 1);
    merged.push(script);
  }

  return { ...pool, [category]: merged.slice(-MAX_CACHED_PER_CATEGORY) };
}

function upsertScript(pool: ScriptPool, previousKey: string | null, script: Script) {
  const nextKey = getScriptKey(script);
  const nextPool: ScriptPool = {};

  for (const category of SCRIPT_CATEGORIES) {
    const existing = (pool[category] ?? []).filter(isValidScript);
    nextPool[category] = existing.filter((item) => {
      const key = getScriptKey(item);
      return key !== previousKey && key !== nextKey;
    });
  }

  const categoryScripts = (nextPool[script.category] ?? []).filter(isValidScript);
  nextPool[script.category] = [...categoryScripts, script].slice(-MAX_CACHED_PER_CATEGORY);
  return nextPool;
}

function deleteScript(pool: ScriptPool, key: string) {
  const nextPool: ScriptPool = {};

  for (const category of SCRIPT_CATEGORIES) {
    const existing = (pool[category] ?? []).filter(isValidScript);
    nextPool[category] = existing.filter((script) => getScriptKey(script) !== key);
  }

  return nextPool;
}

export async function GET() {
  const pool = await readPool();
  return NextResponse.json({ records: getRecords(pool) });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action?: "upsert" | "addGenerated";
    previousKey?: string | null;
    script?: unknown;
    category?: unknown;
    scripts?: unknown;
  };

  const pool = await readPool();

  if (body.action === "addGenerated") {
    const category = typeof body.category === "string" && SCRIPT_CATEGORIES.includes(body.category as (typeof SCRIPT_CATEGORIES)[number])
      ? body.category
      : SCRIPT_CATEGORIES[0];
    const scripts = Array.isArray(body.scripts) ? body.scripts.filter(isValidScript) : [];
    const nextPool = addGeneratedScripts(pool, category, scripts);
    await writePool(nextPool);
    return NextResponse.json({ records: getRecords(nextPool) });
  }

  if (!isValidScript(body.script)) {
    return NextResponse.json({ error: "Invalid script" }, { status: 400 });
  }

  const nextPool = upsertScript(
    pool,
    typeof body.previousKey === "string" ? body.previousKey : null,
    body.script
  );
  await writePool(nextPool);
  return NextResponse.json({ records: getRecords(nextPool) });
}

export async function DELETE(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const pool = await readPool();
  const nextPool = deleteScript(pool, key);
  await writePool(nextPool);
  return NextResponse.json({ records: getRecords(nextPool) });
}
