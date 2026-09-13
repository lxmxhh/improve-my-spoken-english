import { NextRequest, NextResponse } from "next/server";
import { isValidScript, SCRIPT_CATEGORIES } from "@/lib/script-pool";
import {
  addGeneratedScripts,
  deleteScript,
  getAllRecords,
  upsertScript,
  type ScriptRecord,
} from "@/lib/script-store";
import { getCoachLines, hasCachedSpeechTexts, prewarmCoachAudioForScript } from "@/lib/server-tts";
import type { Script } from "@/lib/types";

async function withAudioReady(records: ScriptRecord[]): Promise<ScriptRecord[]> {
  return Promise.all(
    records.map(async (record) => ({
      ...record,
      audioReady: await hasCachedSpeechTexts(getCoachLines(record.script)),
    }))
  );
}

/** Generate coach audio for new scripts without holding up the response. */
function prewarmInBackground(scripts: Script[]) {
  for (const script of scripts) {
    void prewarmCoachAudioForScript(script).catch((error) => {
      console.error("[script-pool] coach audio prewarm failed:", script.topic, error);
    });
  }
}

export async function GET() {
  return NextResponse.json({ records: await withAudioReady(await getAllRecords()) });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action?: "upsert" | "addGenerated";
    previousKey?: string | null;
    script?: unknown;
    category?: unknown;
    scripts?: unknown;
  };

  if (body.action === "addGenerated") {
    const category = typeof body.category === "string" && SCRIPT_CATEGORIES.includes(body.category as (typeof SCRIPT_CATEGORIES)[number])
      ? body.category
      : SCRIPT_CATEGORIES[0];
    const scripts = Array.isArray(body.scripts) ? body.scripts.filter(isValidScript) : [];
    const { records, added } = await addGeneratedScripts(category, scripts);
    prewarmInBackground(added);
    return NextResponse.json({ records: await withAudioReady(records) });
  }

  if (!isValidScript(body.script)) {
    return NextResponse.json({ error: "Invalid script" }, { status: 400 });
  }

  const records = await upsertScript(
    typeof body.previousKey === "string" ? body.previousKey : null,
    body.script
  );
  prewarmInBackground([body.script]);
  return NextResponse.json({ records: await withAudioReady(records) });
}

export async function DELETE(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  return NextResponse.json({ records: await withAudioReady(await deleteScript(key)) });
}
