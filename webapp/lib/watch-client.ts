// Browser side of the watch agent's feed log (webapp/.plans/hermes-watch-agent.md). It only ever
// talks to our own /api routes; when the agent is not set up, the server ignores these calls.
import type { Detection, VideoRecord } from "@/lib/types";
import type { BriefingsResponse, FeedSource } from "@/lib/watch-types";

export const feedSource = (video: Pick<VideoRecord, "id" | "title" | "source">): FeedSource => ({ id: video.id, kind: video.source === "sample" ? "sample" : "upload", title: video.title });

/** Tell the feed log a person reviewed a detection. Fire and forget: a failure never blocks the review. */
export function reportReview(video: VideoRecord, detection: Detection, status: string) {
  fetch("/api/watch/events", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "review", source: feedSource(video), detectionId: detection.id, status, category: detection.category, seconds: detection.seconds }),
  }).catch(() => {});
}

export async function fetchBriefings(signal?: AbortSignal): Promise<BriefingsResponse> {
  const res = await fetch("/api/briefings", { cache: "no-store", signal });
  if (!res.ok) throw new Error(`Briefings returned ${res.status}.`);
  return res.json();
}
