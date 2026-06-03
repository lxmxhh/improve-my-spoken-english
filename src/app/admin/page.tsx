"use client";

import { useEffect, useMemo, useState } from "react";
import {
  deleteFileCachedScript,
  getFileAdminScriptRecords,
  migrateLocalStorageScriptsToFile,
  SCRIPT_CATEGORIES,
  upsertFileCachedScript,
  type AdminScriptRecord,
} from "@/lib/script-pool";
import type { Script, ScriptTurn } from "@/lib/types";

type SourceFilter = "all" | "builtin" | "cached";

interface EditorState {
  mode: "create" | "edit" | "view";
  previousKey: string | null;
  source: AdminScriptRecord["source"] | "cached";
  category: string;
  topic: string;
  turns: ScriptTurn[];
}

const EMPTY_TURNS: ScriptTurn[] = [
  { speaker: "coach", text: "" },
  { speaker: "user", text: "" },
  { speaker: "coach", text: "" },
  { speaker: "user", text: "" },
  { speaker: "coach", text: "" },
  { speaker: "user", text: "" },
];

function cloneTurns(turns: ScriptTurn[]): ScriptTurn[] {
  return turns.map((turn) => ({ ...turn }));
}

function createEditorState(): EditorState {
  return {
    mode: "create",
    previousKey: null,
    source: "cached",
    category: SCRIPT_CATEGORIES[0],
    topic: "",
    turns: cloneTurns(EMPTY_TURNS),
  };
}

function scriptToEditor(record: AdminScriptRecord): EditorState {
  return {
    mode: record.source === "cached" ? "edit" : "view",
    previousKey: record.key,
    source: record.source,
    category: record.script.category,
    topic: record.script.topic,
    turns: cloneTurns(record.script.turns),
  };
}

function validateEditor(editor: EditorState): string[] {
  const errors: string[] = [];

  if (!SCRIPT_CATEGORIES.includes(editor.category as (typeof SCRIPT_CATEGORIES)[number])) {
    errors.push("Choose a valid category.");
  }
  if (!editor.topic.trim()) {
    errors.push("Topic is required.");
  }
  if (editor.turns.length < 6) {
    errors.push("At least 6 turns are required.");
  }

  editor.turns.forEach((turn, index) => {
    if (turn.speaker !== "coach" && turn.speaker !== "user") {
      errors.push(`Turn ${index + 1} needs a valid speaker.`);
    }
    if (!turn.text.trim()) {
      errors.push(`Turn ${index + 1} text is required.`);
    }
  });

  return errors;
}

function normalizeScript(editor: EditorState): Script {
  return {
    category: editor.category,
    topic: editor.topic.trim(),
    turns: editor.turns.map((turn) => ({
      speaker: turn.speaker,
      text: turn.text.trim(),
    })),
  };
}

export default function AdminPage() {
  const [records, setRecords] = useState<AdminScriptRecord[]>([]);
  const [category, setCategory] = useState("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState>(() => createEditorState());
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshRecords = async () => {
    setLoading(true);
    try {
      let nextRecords = await getFileAdminScriptRecords();
      if (!nextRecords.some((record) => record.source === "cached")) {
        const migrated = await migrateLocalStorageScriptsToFile();
        if (migrated) nextRecords = await getFileAdminScriptRecords();
      }
      setRecords(nextRecords);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void refreshRecords();
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  const counts = useMemo(() => {
    const cached = records.filter((record) => record.source === "cached").length;
    const builtin = records.filter((record) => record.source === "builtin").length;
    return { total: records.length, cached, builtin };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return records.filter((record) => {
      if (category !== "all" && record.script.category !== category) return false;
      if (source !== "all" && record.source !== source) return false;
      if (!needle) return true;

      const haystack = [
        record.script.topic,
        record.script.category,
        ...record.script.turns.map((turn) => turn.text),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [category, query, records, source]);

  const validationErrors = validateEditor(editor);
  const isReadOnly = editor.mode === "view";

  const updateTurn = (index: number, patch: Partial<ScriptTurn>) => {
    setEditor((current) => ({
      ...current,
      turns: current.turns.map((turn, turnIndex) => (
        turnIndex === index ? { ...turn, ...patch } : turn
      )),
    }));
  };

  const addTurn = () => {
    setEditor((current) => ({
      ...current,
      turns: [
        ...current.turns,
        {
          speaker: current.turns.length % 2 === 0 ? "coach" : "user",
          text: "",
        },
      ],
    }));
  };

  const removeTurn = (index: number) => {
    setEditor((current) => ({
      ...current,
      turns: current.turns.filter((_, turnIndex) => turnIndex !== index),
    }));
  };

  const saveScript = async () => {
    const errors = validateEditor(editor);
    if (errors.length > 0 || isReadOnly) return;

    try {
      setRecords(await upsertFileCachedScript(editor.previousKey, normalizeScript(editor)));
      setEditor(createEditorState());
      setMessage("Script saved to data/script-pool.json.");
    } catch {
      setMessage("Could not save script.");
    }
  };

  const deleteScript = async (record: AdminScriptRecord) => {
    if (record.source !== "cached") return;
    const confirmed = window.confirm(`Delete "${record.script.topic}" from local scripts?`);
    if (!confirmed) return;

    try {
      setRecords(await deleteFileCachedScript(record.key));
      if (editor.previousKey === record.key) setEditor(createEditorState());
      setMessage("Script deleted from data/script-pool.json.");
    } catch {
      setMessage("Could not delete script.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Local tools
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950">
              Admin
            </h1>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:w-96">
            {[
              ["Total", counts.total],
              ["Local", counts.cached],
              ["Built-in", counts.builtin],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {label}
                </p>
                <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        </header>

        {message && (
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            <span>{message}</span>
            <button
              type="button"
              onClick={() => setMessage(null)}
              className="h-7 w-7 rounded-full text-emerald-700 hover:bg-emerald-100"
              aria-label="Dismiss message"
            >
              x
            </button>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search topic or text"
                  className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="all">All categories</option>
                    {SCRIPT_CATEGORIES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                  <select
                    value={source}
                    onChange={(event) => setSource(event.target.value as SourceFilter)}
                    className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="all">All sources</option>
                    <option value="cached">Local only</option>
                    <option value="builtin">Built-in only</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditor(createEditorState());
                    setMessage(null);
                  }}
                  className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  + Add
                </button>
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {filteredRecords.length === 0 ? (
                <div className="px-4 py-14 text-center">
                  <p className="text-sm font-semibold text-gray-700">
                    {loading ? "Loading scripts" : "No scripts found"}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {loading ? "Reading data/script-pool.json." : "Adjust filters or add a local script."}
                  </p>
                </div>
              ) : (
                filteredRecords.map((record) => (
                  <article key={record.key} className="px-4 py-4 transition hover:bg-gray-50">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setEditor(scriptToEditor(record));
                          setMessage(null);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-sm font-semibold text-gray-900">
                            {record.script.topic}
                          </h2>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            record.source === "cached"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {record.source === "cached" ? "Local" : "Built-in"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                          {record.script.category} · {record.script.turns.length} turns
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm leading-5 text-gray-600">
                          {record.script.turns[0]?.text}
                        </p>
                      </button>

                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditor(scriptToEditor(record));
                            setMessage(null);
                          }}
                          className="h-9 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 transition hover:bg-gray-100"
                        >
                          {record.source === "cached" ? "Edit" : "View"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteScript(record)}
                          disabled={record.source !== "cached"}
                          className="h-9 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300 disabled:hover:bg-white"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <aside className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {editor.mode === "create" ? "New script" : editor.mode === "view" ? "Read-only" : "Local script"}
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-gray-900">
                    {editor.mode === "create" ? "Add Script" : editor.topic || "Untitled"}
                  </h2>
                </div>
                {isReadOnly && (
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Built-in
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4 p-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Category</span>
                <select
                  value={editor.category}
                  onChange={(event) => setEditor((current) => ({ ...current, category: event.target.value }))}
                  disabled={isReadOnly}
                  className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-500"
                >
                  {SCRIPT_CATEGORIES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Topic</span>
                <input
                  value={editor.topic}
                  onChange={(event) => setEditor((current) => ({ ...current, topic: event.target.value }))}
                  disabled={isReadOnly}
                  className="h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-500"
                  placeholder="Ordering Coffee"
                />
              </label>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Turns</p>
                  <button
                    type="button"
                    onClick={addTurn}
                    disabled={isReadOnly}
                    className="h-8 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
                  >
                    + Turn
                  </button>
                </div>

                <div className="flex max-h-[520px] flex-col gap-2 overflow-auto pr-1">
                  {editor.turns.map((turn, index) => (
                    <div key={index} className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                      <div className="mb-2 flex items-center gap-2">
                        <select
                          value={turn.speaker}
                          onChange={(event) => updateTurn(index, { speaker: event.target.value as ScriptTurn["speaker"] })}
                          disabled={isReadOnly}
                          className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold outline-none focus:border-blue-400 disabled:bg-gray-100 disabled:text-gray-500"
                        >
                          <option value="coach">Coach</option>
                          <option value="user">User</option>
                        </select>
                        <span className="text-xs font-semibold text-gray-400">#{index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeTurn(index)}
                          disabled={isReadOnly || editor.turns.length <= 6}
                          className="ml-auto h-8 w-8 rounded-md text-sm font-semibold text-gray-400 transition hover:bg-white hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-200 disabled:hover:bg-transparent"
                          aria-label={`Remove turn ${index + 1}`}
                        >
                          -
                        </button>
                      </div>
                      <textarea
                        value={turn.text}
                        onChange={(event) => updateTurn(index, { text: event.target.value })}
                        disabled={isReadOnly}
                        rows={2}
                        className="min-h-16 w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-sm leading-5 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder={turn.speaker === "coach" ? "Coach line" : "User answer"}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {validationErrors.length > 0 && !isReadOnly && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  {validationErrors.slice(0, 3).map((error) => (
                    <p key={error} className="text-xs leading-5 text-amber-700">{error}</p>
                  ))}
                  {validationErrors.length > 3 && (
                    <p className="text-xs leading-5 text-amber-700">
                      {validationErrors.length - 3} more issues.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditor(createEditorState());
                    setMessage(null);
                  }}
                  className="h-11 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => void saveScript()}
                  disabled={isReadOnly || validationErrors.length > 0}
                  className="h-11 rounded-lg bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Save
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
