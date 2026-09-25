"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SeverityBadge } from "./ui";
import { boxAt } from "@/lib/vlm/boxes";
import { isSecurityDetection, timecode, type Detection, type VideoRecord } from "@/lib/types";

/** Seconds of footage around a detection that the tile loops: a little lead-in, the flagged span and its keyframes, at least 4 s. */
function loopSegment(d: Detection, duration: number) {
 const kfs = d.keyframes ?? [];
 const first = Math.min(d.seconds, kfs[0]?.seconds ?? d.seconds), last = Math.max(d.endSeconds ?? d.seconds, kfs[kfs.length - 1]?.seconds ?? d.seconds);
 const start = Math.max(0, first - 1);
 const end = Math.min(duration || Infinity, Math.max(last + 1.5, start + 4));
 return { start, end };
}

/** A muted feed that loops the moment of a recording's most serious detection, with the tracked boxes drawn as it plays.
 *  It plays only while on screen, and holds still for people who ask for reduced motion. */
export function MonitorTile({video,detection,index}:{video:VideoRecord;detection:Detection;index:number}){
 const [src,setSrc]=useState("");
 const [failed,setFailed]=useState(false);
 const [t,setT]=useState(detection.seconds);
 const player=useRef<HTMLVideoElement>(null);
 const {start,end}=loopSegment(detection,video.duration);

 useEffect(()=>{
  if(video.source==="sample"){setSrc(video.mediaPath??"");return;}
  if(!video.blob){setFailed(true);return;}
  const url=URL.createObjectURL(video.blob); setSrc(url);
  return()=>URL.revokeObjectURL(url);
 },[video.source,video.mediaPath,video.blob]);

 // Play while visible; follow playback every animation frame so boxes move smoothly; wrap back to the segment start.
 useEffect(()=>{
  const v=player.current; if(!v||!src) return;
  const still=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf=0;
  const tick=()=>{ if(v.currentTime>=end||v.currentTime<start-.25) v.currentTime=start; setT(v.currentTime); raf=requestAnimationFrame(tick); };
  const io=new IntersectionObserver(([e])=>{
   cancelAnimationFrame(raf);
   if(e.isIntersecting&&!still){ v.play().catch(()=>{}); raf=requestAnimationFrame(tick); } else v.pause();
  },{threshold:.25});
  io.observe(v);
  return()=>{ io.disconnect(); cancelAnimationFrame(raf); v.pause(); };
 },[src,start,end]);

 const boxes=video.detections.filter(isSecurityDetection).flatMap(d=>{const b=boxAt(d,t);return b?[{id:d.id,box:b,category:d.category}]:[]});
 return <Link href={`/videos/${video.id}?t=${Math.floor(detection.seconds)}`} className="group block relative overflow-hidden rounded-lg border border-base-300 bg-black hover:border-base-content transition-colors focus-visible:outline-2 focus-visible:outline-primary">
  <div className="relative aspect-video bg-black">
   {src&&!failed?<video ref={player} src={src} muted playsInline preload="auto" className="absolute inset-0 size-full object-cover"
     onLoadedMetadata={e=>{e.currentTarget.currentTime=start;}}
     onError={()=>setFailed(true)}/>
   :<div className="absolute inset-0 grid place-items-center text-xs text-base-content/40">{failed?"no stored footage":"loading feed"}</div>}

   {boxes.map(({id,box,category})=><div key={id} className="absolute border-[1.5px] border-white rounded-md shadow-[0_0_0_1px_rgba(0,0,0,.65)]" style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`}}>
    <span className="absolute left-0 bottom-full whitespace-nowrap bg-white text-black font-mono text-[.55rem] uppercase tracking-[.08em] px-1.5 py-[2px] rounded-t-[2px]">{category}</span>
   </div>)}

   {/* Corner ticks, so an empty frame still reads as a monitor rather than a broken image. */}
   <span className="absolute inset-2 pointer-events-none border border-white/10 rounded"/>
   <span className="absolute top-2 left-2.5 flex items-center gap-1.5 font-mono text-[.58rem] tracking-widest text-white/70 drop-shadow"><span className="size-1.5 rounded-full bg-white/80 motion-safe:animate-pulse"/>CH{String(index+1).padStart(2,"0")}</span>
   <span className="absolute top-2 right-2"><SeverityBadge severity={detection.severity}/></span>

   <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent pt-8 pb-2 px-2.5">
    <div className="flex items-end justify-between gap-2">
     <span className="min-w-0"><span className="block text-xs font-medium text-white truncate">{video.title}</span>
      <span className="block font-mono text-[.6rem] text-white/60 truncate">{detection.category} · {timecode(start)}–{timecode(end)}</span></span>
     {video.source==="sample"&&<span className="font-mono text-[.55rem] uppercase tracking-wider text-white/45 shrink-0">sim</span>}
    </div>
   </div>
  </div>
 </Link>;
}
