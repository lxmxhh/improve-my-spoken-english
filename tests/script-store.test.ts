import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Script } from "@/lib/types";

let dir: string;
let seedPath: string;
let poolPath: string;

function makeScript(topic: string, category = "Daily Life", suffix = ""): Script {
  return {
    topic,
    category,
    turns: [
      { speaker: "coach", text: `Q1 about ${topic}${suffix}` },
      { speaker: "user", text: `A1 about ${topic}${suffix}` },
      { speaker: "coach", text: "Q2" },
      { speaker: "user", text: "A2" },
      { speaker: "coach", text: "Q3" },
      { speaker: "user", text: "A3" },
    ],
  };
}

async function loadStore() {
  process.env.SCRIPT_SEED_PATH = seedPath;
  process.env.SCRIPT_POOL_PATH = poolPath;
  vi.resetModules();
  return import("@/lib/script-store");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "script-store-"));
  seedPath = join(dir, "seed.json");
  poolPath = join(dir, "pool.json");
});

afterEach(async () => {
  delete process.env.SCRIPT_SEED_PATH;
  delete process.env.SCRIPT_POOL_PATH;
  await rm(dir, { recursive: true, force: true });
});

describe("script-store read/merge", () => {
  it("merges seed and runtime pool, with runtime overriding a same-key seed script", async () => {
    const seedScript = makeScript("Morning");
    const enriched: Script = {
      ...seedScript,
      turns: seedScript.turns.map((turn, i) =>
        i === 1 ? { ...turn, anchor: { intent: "x", keyPoints: ["y"], sampleAnswer: turn.text } } : turn
      ),
    };
    await writeFile(seedPath, JSON.stringify({ "Daily Life": [seedScript, makeScript("Lunch")] }));
    await writeFile(poolPath, JSON.stringify({ "Daily Life": [enriched, makeScript("Dinner")] }));

    const { readMergedPool, readSeedPool, readRuntimePool, getRecords } = await loadStore();
    const merged = await readMergedPool();
    const topics = merged["Daily Life"]!.map((s) => s.topic);
    expect(topics).toEqual(["Morning", "Lunch", "Dinner"]);
    expect(merged["Daily Life"]![0].turns[1].anchor?.intent).toBe("x");

    const records = getRecords(await readSeedPool(), await readRuntimePool());
    const bySource = Object.fromEntries(records.map((r) => [r.script.topic, r.source]));
    expect(bySource).toMatchObject({ Morning: "seed", Lunch: "seed", Dinner: "cached" });
    expect(records.some((r) => r.source === "builtin")).toBe(true);
  });

  it("treats missing files as empty pools", async () => {
    const { readMergedPool } = await loadStore();
    expect(await readMergedPool()).toEqual({});
  });
});

describe("script-store writes", () => {
  it("addGeneratedScripts writes only the runtime pool and dedupes against the seed", async () => {
    const seedScript = makeScript("Morning");
    await writeFile(seedPath, JSON.stringify({ "Daily Life": [seedScript] }));

    const { addGeneratedScripts, readRuntimePool } = await loadStore();
    await addGeneratedScripts("Daily Life", [seedScript, makeScript("Evening")]);

    const runtime = await readRuntimePool();
    expect(runtime["Daily Life"]!.map((s) => s.topic)).toEqual(["Evening"]);
    expect(JSON.parse(await readFile(seedPath, "utf8"))["Daily Life"]).toHaveLength(1);
  });

  it("addGeneratedScripts caps variants per topic across seed + runtime", async () => {
    await writeFile(seedPath, JSON.stringify({ "Daily Life": [makeScript("Morning", "Daily Life", " v1")] }));
    const { addGeneratedScripts, readRuntimePool } = await loadStore();
    await addGeneratedScripts("Daily Life", [
      makeScript("Morning", "Daily Life", " v2"),
      makeScript("morning", "Daily Life", " v3"),
    ]);
    expect((await readRuntimePool())["Daily Life"]).toHaveLength(1);
  });

  it("upsertScript with a seed key stores an override in the runtime pool", async () => {
    const seedScript = makeScript("Morning");
    await writeFile(seedPath, JSON.stringify({ "Daily Life": [seedScript] }));
    const { upsertScript, readRuntimePool, readMergedPool, getScriptKey } = await loadStore();

    const enriched = { ...seedScript, turns: seedScript.turns.map((t) => ({ ...t, hint: "h" })) };
    await upsertScript(getScriptKey(seedScript), enriched);

    expect((await readRuntimePool())["Daily Life"]).toHaveLength(1);
    const merged = await readMergedPool();
    expect(merged["Daily Life"]).toHaveLength(1);
    expect(merged["Daily Life"]![0].turns[0].hint).toBe("h");
  });

  it("deleteScript only removes runtime scripts", async () => {
    const seedScript = makeScript("Morning");
    const runtimeScript = makeScript("Dinner");
    await writeFile(seedPath, JSON.stringify({ "Daily Life": [seedScript] }));
    await writeFile(poolPath, JSON.stringify({ "Daily Life": [runtimeScript] }));
    const { deleteScript, readMergedPool, getScriptKey } = await loadStore();

    await deleteScript(getScriptKey(seedScript));
    await deleteScript(getScriptKey(runtimeScript));

    expect((await readMergedPool())["Daily Life"]!.map((s) => s.topic)).toEqual(["Morning"]);
  });
});
