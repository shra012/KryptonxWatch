"use client";
// Removes recordings of clips taken out of the demo set (data/demo-clips-excluded: the model did not identify them
// correctly), whether the demo loader added them or they were uploaded by hand. Matched by exact file size. Once per load.
import { useEffect, useRef } from "react";
import { useApp } from "./app-provider";

export function ExcludedCleanup() {
  const { videos, loading, deleteVideo, notify } = useApp();
  const done = useRef(false);
  useEffect(() => {
    if (loading || done.current) return;
    done.current = true;
    fetch("/api/demo-clips").then(r => r.json()).then(async ({ excluded }: { excluded?: number[] }) => {
      if (!excluded?.length) return;
      const stale = videos.filter(v => v.source === "upload" && excluded.includes(v.size ?? v.blob?.size ?? -1));
      for (const v of stale) await deleteVideo(v.id).catch(() => {});
      if (stale.length) notify(`Removed ${stale.length} recording${stale.length === 1 ? "" : "s"} no longer in the demo set`);
    }).catch(() => {});
  }, [loading, videos, deleteVideo, notify]);
  return null;
}
