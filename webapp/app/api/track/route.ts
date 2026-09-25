import { NextResponse } from "next/server";
import { detectPersons, yoloConfigured } from "@/lib/server/yolo";

export const dynamic = "force-dynamic";

const IMAGE = /^data:image\/(jpeg|png|webp);base64,/;
const MAX_FRAMES = 16;

// People on a batch of frames, for following a suspect through the whole video after analysis (lib/vlm/boxes.ts trackThroughVideo).
export async function POST(request: Request) {
  if (!yoloConfigured()) return NextResponse.json({ configured: false, error: "Tracking needs the YOLO service (YOLO_BASE_URL)." }, { status: 503 });
  let frames: unknown;
  try { ({ frames } = await request.json()); } catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
  if (!Array.isArray(frames) || !frames.length || frames.length > MAX_FRAMES) return NextResponse.json({ error: `Send 1–${MAX_FRAMES} frames.` }, { status: 400 });
  for (const f of frames) {
    if (!f || typeof f.seconds !== "number" || !Number.isFinite(f.seconds) || typeof f.image !== "string" || !IMAGE.test(f.image) || f.image.length > 1_500_000)
      return NextResponse.json({ error: "Each frame needs finite seconds and a JPEG, PNG or WebP data URL under 1.5 MB." }, { status: 400 });
  }
  const persons = await detectPersons(frames as { seconds: number; image: string }[], request.signal);
  if (!persons) return NextResponse.json({ configured: true, error: "The YOLO service did not answer." }, { status: 502 });
  return NextResponse.json({ configured: true, persons });
}
