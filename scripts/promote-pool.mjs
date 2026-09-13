#!/usr/bin/env node
/**
 * Promote runtime-generated scripts into the git-tracked seed library.
 *
 *   node scripts/promote-pool.mjs [--pool data/script-pool.json] [--seed data/script-seed.json] [--dry-run]
 *
 * Typical flow: copy the production data/script-pool.json locally, run this, review the
 * diff of data/script-seed.json, commit. The runtime pool file is left untouched.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MAX_VARIANTS_PER_TOPIC = 2;

function isValidScript(value) {
  return (
    value && typeof value === "object" &&
    typeof value.topic === "string" && typeof value.category === "string" &&
    Array.isArray(value.turns) && value.turns.length >= 6 &&
    value.turns.every((t) => t && (t.speaker === "coach" || t.speaker === "user") && typeof t.text === "string" && t.text.trim())
  );
}

const scriptKey = (s) => `${s.category}::${s.topic}::${s.turns.map((t) => t.text).join("|")}`;
const topicKey = (topic) => topic.trim().toLowerCase().replace(/\s+/g, " ");

export function promotePool(seed, pool) {
  const next = {};
  const summary = { updated: 0, added: 0, skipped: 0 };
  const categories = [...new Set([...Object.keys(seed), ...Object.keys(pool)])];

  for (const category of categories) {
    const scripts = (seed[category] ?? []).filter(isValidScript);
    const index = new Map(scripts.map((s, i) => [scriptKey(s), i]));
    const topicCounts = new Map();
    for (const s of scripts) topicCounts.set(topicKey(s.topic), (topicCounts.get(topicKey(s.topic)) ?? 0) + 1);

    for (const candidate of pool[category] ?? []) {
      if (!isValidScript(candidate) || candidate.category !== category) { summary.skipped += 1; continue; }
      const key = scriptKey(candidate);
      if (index.has(key)) {
        if (JSON.stringify(scripts[index.get(key)]) !== JSON.stringify(candidate)) {
          scripts[index.get(key)] = candidate;
          summary.updated += 1;
        }
        continue;
      }
      const tk = topicKey(candidate.topic);
      if ((topicCounts.get(tk) ?? 0) >= MAX_VARIANTS_PER_TOPIC) { summary.skipped += 1; continue; }
      topicCounts.set(tk, (topicCounts.get(tk) ?? 0) + 1);
      index.set(key, scripts.length);
      scripts.push(candidate);
      summary.added += 1;
    }

    if (scripts.length > 0) next[category] = scripts;
  }

  return { seed: next, summary };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const poolPath = opt("--pool", "data/script-pool.json");
  const seedPath = opt("--seed", "data/script-seed.json");
  const dryRun = args.includes("--dry-run");

  const { seed, summary } = promotePool(await readJson(seedPath), await readJson(poolPath));
  const total = Object.values(seed).reduce((n, list) => n + list.length, 0);
  console.log(`promote ${poolPath} -> ${seedPath}: updated ${summary.updated}, added ${summary.added}, skipped ${summary.skipped}; seed now ${total} scripts${dryRun ? " (dry run, not written)" : ""}`);
  if (!dryRun) await writeFile(seedPath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
