"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSessions } from "@/lib/storage";
import type { Session } from "@/lib/types";

function groupByDate(sessions: Session[]): Record<string, Session[]> {
  return sessions.reduce<Record<string, Session[]>>((acc, s) => {
    (acc[s.date] ??= []).push(s);
    return acc;
  }, {});
}

export default function HistoryPage() {
  const [groups, setGroups] = useState<[string, Session[]][]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const sessions = getSessions();
    const grouped = groupByDate(sessions);
    const sorted = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));
    setGroups(sorted);
  }, []);

  if (groups.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-6 text-center">
        <p className="text-5xl">🎙️</p>
        <div>
          <p className="text-lg font-semibold text-gray-800">No sessions yet</p>
          <p className="text-gray-500 text-sm mt-1">Start your first practice to see your history here.</p>
        </div>
        <Link
          href="/"
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-xl transition-colors"
        >
          Go Practice
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-10 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Practice History</h1>

      <div className="flex flex-col gap-6">
        {groups.map(([date, sessions]) => (
          <div key={date}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
              {new Date(date + "T00:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
            <div className="flex flex-col gap-2">
              {sessions.map((s) => {
                const key = `${s.id}`;
                const pct = s.totalLines > 0 ? Math.round((s.passedLines / s.totalLines) * 100) : 0;
                const isOpen = expanded === key;
                return (
                  <div key={key} className="border border-gray-100 rounded-2xl overflow-hidden">
                    <button
                      onClick={() => setExpanded(isOpen ? null : key)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-800 text-sm">{s.topic}</span>
                        <span className="text-xs text-gray-400">{s.category} · {Math.round(s.durationSec / 60)} min</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${pct >= 70 ? "text-emerald-600" : pct >= 40 ? "text-amber-500" : "text-red-500"}`}>
                          {pct}%
                        </span>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    {isOpen && s.summary && (
                      <div className="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50">
                        <p className="text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">{s.summary}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center">
        <Link href="/" className="text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors">
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
