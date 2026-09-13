import { NextRequest, NextResponse } from "next/server";
import { isValidScript, SCRIPT_CATEGORIES } from "@/lib/script-pool";
import { addGeneratedScripts, deleteScript, getAllRecords, upsertScript } from "@/lib/script-store";

export async function GET() {
  return NextResponse.json({ records: await getAllRecords() });
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
    return NextResponse.json({ records: await addGeneratedScripts(category, scripts) });
  }

  if (!isValidScript(body.script)) {
    return NextResponse.json({ error: "Invalid script" }, { status: 400 });
  }

  const records = await upsertScript(
    typeof body.previousKey === "string" ? body.previousKey : null,
    body.script
  );
  return NextResponse.json({ records });
}

export async function DELETE(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  return NextResponse.json({ records: await deleteScript(key) });
}
