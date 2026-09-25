import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { demoClipsDir, listDemoClips } from "@/lib/server/demo-clips";

export const dynamic = "force-dynamic";

// One demo clip. Only names from the folder listing are served, so no other path can be read.
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!(await listDemoClips())?.some(c => c.file === file)) return NextResponse.json({ error: "Unknown demo clip." }, { status: 404 });
  const data = await readFile(path.join(demoClipsDir(), file));
  return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": file.endsWith(".webm") ? "video/webm" : "video/mp4", "Content-Length": String(data.length), "Cache-Control": "no-store" } });
}
