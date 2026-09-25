import { NextResponse } from "next/server";
import { detectPose, yoloConfigured } from "@/lib/server/yolo";

export const dynamic = "force-dynamic";

const IMAGE = /^data:image\/(jpeg|png|webp);base64,/;

// Body joints for one live frame, from the YOLO pose model on the edge node.
export async function POST(request: Request) {
  if (!yoloConfigured()) return NextResponse.json({ configured: false, error: "Body joints need the YOLO service. Set YOLO_BASE_URL in webapp/.env.local and start model/YOLO/src/yolo_server.py." }, { status: 503 });
  let image: unknown;
  try { ({ image } = await request.json()); } catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
  if (typeof image !== "string" || !IMAGE.test(image) || image.length > 1_500_000) return NextResponse.json({ error: "Send one JPEG, PNG or WebP data URL under 1.5 MB." }, { status: 400 });
  const started = Date.now();
  const pose = await detectPose(image, request.signal);
  if (!pose) return NextResponse.json({ configured: true, error: "The YOLO service did not answer. Is yolo_server.py running at YOLO_BASE_URL?" }, { status: 502 });
  return NextResponse.json({ configured: true, ...pose, latencyMs: Date.now() - started });
}
