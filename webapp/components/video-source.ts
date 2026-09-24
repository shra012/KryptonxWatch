import type { VideoRecord } from "@/lib/types";
export function videoSource(video:VideoRecord):string|undefined { return video.source==="sample"?video.mediaPath:undefined; }
