"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SeverityBadge } from "./ui";
import { timecode, type Detection, type VideoRecord } from "@/lib/types";

/** One frame of footage held at the moment of a detection, with the model's box on it.
 *  It is a still, not a playing feed: the tile seeks once and pauses. */
export function MonitorTile({video,detection,index}:{video:VideoRecord;detection?:Detection;index:number}){
 const [src,setSrc]=useState("");
 const [failed,setFailed]=useState(false);
 const player=useRef<HTMLVideoElement>(null);
 const at=detection?.seconds??Math.min(3,video.duration/2);

 useEffect(()=>{
  if(video.source==="sample"){setSrc(video.mediaPath??"");return;}
  if(!video.blob){setFailed(true);return;}
  const url=URL.createObjectURL(video.blob); setSrc(url);
  return()=>URL.revokeObjectURL(url);
 },[video.source,video.mediaPath,video.blob]);

 const box=detection?.box;
 return <Link href={`/videos/${video.id}${detection?`?t=${Math.floor(detection.seconds)}`:""}`} className="group block relative overflow-hidden rounded-[3px] border border-base-300 bg-black hover:border-base-content transition-colors focus-visible:outline-2 focus-visible:outline-primary">
  <div className="relative aspect-video bg-black">
   {src&&!failed?<video ref={player} src={src} muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover"
     onLoadedMetadata={e=>{const v=e.currentTarget; v.currentTime=Math.min(at,Math.max(0,v.duration-.1));}}
     onError={()=>setFailed(true)}/>
   :<div className="absolute inset-0 grid place-items-center text-xs text-base-content/40">{failed?"no stored frame":"loading frame"}</div>}

   {box&&<div className="absolute border-[1.5px] border-white rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,.65)]" style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`}}>
    <span className="absolute left-0 bottom-full whitespace-nowrap bg-white text-black font-mono text-[.55rem] uppercase tracking-[.08em] px-1.5 py-[2px] rounded-t-[2px]">{box.label}</span>
   </div>}

   {/* Corner ticks, so an empty frame still reads as a monitor rather than a broken image. */}
   <span className="absolute inset-2 pointer-events-none border border-white/10 rounded"/>
   <span className="absolute top-2 left-2.5 font-mono text-[.58rem] tracking-widest text-white/70 drop-shadow">CH{String(index+1).padStart(2,"0")}</span>
   {detection&&<span className="absolute top-2 right-2"><SeverityBadge severity={detection.severity}/></span>}

   <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent pt-8 pb-2 px-2.5">
    <div className="flex items-end justify-between gap-2">
     <span className="min-w-0"><span className="block text-xs font-medium text-white truncate">{video.title}</span>
      <span className="block font-mono text-[.6rem] text-white/60">{detection?`${detection.category} · ${timecode(detection.seconds)}`:"no annotation"}</span></span>
     {video.source==="sample"&&<span className="font-mono text-[.55rem] uppercase tracking-wider text-white/45 shrink-0">sim</span>}
    </div>
   </div>
  </div>
 </Link>;
}
