// The wire format between the browser's camera wall and the detection service
// running on the ZGX. Boxes are fractions of frame width/height, never pixels,
// so a frame downscaled for transport still lands the box in the right place.
import type { BoundingBox, Category, Severity } from "./types";

export interface LiveDetection { id: string; category: Category; severity: Severity; description: string; box: BoundingBox; confidence?: number }
export interface DetectResponse {
  detections: LiveDetection[];
  modelMs: number | null;      // time the node spent on inference, when it reports it
  simulated: boolean;          // true if the service says these are not real findings
}
export interface DetectStatus { configured: boolean; reason: string; endpoint: string | null }

/** Guards the service's reply: anything malformed is dropped rather than drawn. */
export function parseDetections(value: unknown): LiveDetection[] {
  const list = (value as { detections?: unknown })?.detections;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw, i) => {
    const d = raw as Record<string, unknown>, b = d?.box as Record<string, unknown> | undefined;
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
    const x = num(b?.x), y = num(b?.y), width = num(b?.width), height = num(b?.height);
    if (x == null || y == null || width == null || height == null) return [];
    return [{
      id: typeof d.id === "string" ? d.id : `live-${i}`,
      category: (typeof d.category === "string" ? d.category : "Suspicious activity") as Category,
      severity: (typeof d.severity === "string" ? d.severity : "medium") as Severity,
      description: typeof d.description === "string" ? d.description : "",
      confidence: num(d.confidence) ?? undefined,
      box: { x, y, width, height, label: typeof b?.label === "string" ? b.label : "detection" } as BoundingBox,
    }];
  });
}
