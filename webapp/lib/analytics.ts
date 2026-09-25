import { type Detection, type VideoRecord, categories, severityOrder, isSecurityDetection } from "./types";
export function allDetections(videos: VideoRecord[]) { return videos.flatMap(v=>v.detections.map(d=>({...d,videoTitle:v.title,recordedAt:v.recordedAt,source:v.source,alertTo:v.alertTo}))); }
export function counts(videos: VideoRecord[]) { const all=allDetections(videos); const active=all.filter(isSecurityDetection); return {videos:videos.length,detections:active.length,high:active.filter(d=>d.severity==="critical" || d.severity==="high").length,reviewed:active.filter(d=>d.status==="reviewed").length,measurements:all.filter(d=>d.severity==="measurement" && d.status!=="dismissed").length}; }
export function categoryChart(videos: VideoRecord[]) {const all=allDetections(videos).filter(d=>d.status!=="dismissed"); return categories.map(name=>({name,value:all.filter(d=>d.category===name).length})).filter(x=>x.value>0);}
export function severityChart(videos: VideoRecord[]) {const all=allDetections(videos).filter(d=>d.status!=="dismissed"); return severityOrder.map(name=>({name,value:all.filter(d=>d.severity===name).length})).filter(x=>x.value>0);}
export function videoChart(videos: VideoRecord[]) {return videos.map(v=>({id:v.id,source:v.source,name:v.title.replace(" · simulated",""),value:v.detections.filter(isSecurityDetection).length}));}
export function trendChart(videos: VideoRecord[]) {return [...new Set(videos.map(v=>v.recordedAt.slice(0,10)))].sort().map(date=>({date,value:videos.filter(v=>v.recordedAt.slice(0,10)===date).flatMap(v=>v.detections).filter(isSecurityDetection).length}));}
export function csvForDetections(rows: (Detection & {videoTitle:string;recordedAt:string})[]) {const cells=(items:(string|number)[])=>items.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(","); return [cells(["Video","Recorded at","Time (seconds)","Category","Severity","Status","Description"]),...rows.map(r=>cells([r.videoTitle,r.recordedAt,r.seconds,r.category,r.severity,r.status,r.description]))].join("\r\n");}
export function downloadCsv(rows: (Detection & {videoTitle:string;recordedAt:string})[]) {const blob=new Blob(["\uFEFF"+csvForDetections(rows)],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="sentinel-machines-detections.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function statusChart(videos: VideoRecord[]) {const all=allDetections(videos).filter(d=>d.severity!=="measurement"); return (["new","reviewed","dismissed"] as const).map(name=>({name,value:all.filter(d=>d.status===name).length}));}
export function sourceCounts(videos: VideoRecord[]) {return {samples:videos.filter(v=>v.source==="sample").length,uploads:videos.filter(v=>v.source==="upload").length,analysed:videos.filter(v=>v.source==="upload"&&v.analysis==="complete").length};}

/** The same footage uploaded twice (e.g. a manual upload and the demo-clip copy) has the same file size and length. */
function footageKey(v: VideoRecord) { return v.mediaPath ?? `${v.size ?? v.blob?.size ?? v.id}:${Math.round(v.duration)}`; }
/**
 * One recording per piece of footage, for the monitor walls: the analysed one, then the verified demo analysis,
 * then the newest. Same footage = same file (size and length) or, given visual fingerprints (lib/fingerprint.ts),
 * the same frames, which also catches trimmed or re-encoded copies.
 */
export function uniqueFootage(videos: VideoRecord[], sameFrames?: (a: VideoRecord, b: VideoRecord) => boolean): VideoRecord[] {
  const score = (v: VideoRecord) => (v.analysis === "complete" ? 2 : 0) + (v.curatedAnalysis ? 1 : 0);
  const better = (a: VideoRecord, b: VideoRecord) => score(a) > score(b) || (score(a) === score(b) && a.recordedAt > b.recordedAt);
  const groups: VideoRecord[][] = [];
  for (const v of videos) {
    const group = groups.find(g => g.some(w => footageKey(w) === footageKey(v) || (sameFrames?.(w, v) ?? false)));
    if (group) group.push(v); else groups.push([v]);
  }
  const keep = new Set(groups.map(g => g.reduce((a, b) => (better(b, a) ? b : a))));
  return videos.filter(v => keep.has(v));
}
