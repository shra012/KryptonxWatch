"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { useApp } from "./app-provider";
import { Notice } from "./ui";
import { analyzeRecording, useModelStatus } from "@/lib/detection-client";
import type { VideoRecord } from "@/lib/types";

type Clip = { file: string; title: string };

function durationOf(blob: Blob): Promise<number> {
 return new Promise((resolve, reject) => {
  const el = document.createElement("video"); const url = URL.createObjectURL(blob);
  el.preload = "metadata"; el.muted = true;
  el.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(el.duration); };
  el.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The browser could not read this clip.")); };
  el.src = url;
 });
}

/** Copies the server's demo clips (12 UCF-Crime clips) into this browser as recordings, then runs AI analysis on each in turn. */
export function DemoClips(){
 const {videos,saveVideo}=useApp();
 const model=useModelStatus();
 const [clips,setClips]=useState<Clip[]|null>(null);
 const [analyze,setAnalyze]=useState(true);
 const [status,setStatus]=useState("");
 const [running,setRunning]=useState(false);
 const [errors,setErrors]=useState<string[]>([]);
 const abort=useRef<AbortController|null>(null);
 useEffect(()=>{fetch("/api/demo-clips").then(r=>r.json()).then(d=>setClips(d.available?d.clips:[])).catch(()=>setClips([]));return()=>abort.current?.abort();},[]);
 if(!clips?.length) return null;

 const idOf=(c:Clip)=>`demo-${c.title}`;
 const missing=clips.filter(c=>!videos.some(v=>v.id===idOf(c)));
 const unanalysed=clips.map(c=>videos.find(v=>v.id===idOf(c))).filter((v):v is VideoRecord=>!!v&&v.analysis!=="complete");
 const canAnalyze=!!model?.configured;

 async function run(){
  const ctrl=new AbortController(); abort.current=ctrl; setRunning(true); setErrors([]);
  const failed:string[]=[]; const queue:{video:VideoRecord;blob:Blob}[]=[];
  const now=Date.now();
  try{
   // Copy first, so every clip is in the library even if analysis is cancelled. Earlier clips get later times so the library keeps the server's order.
   for(const [i,c] of missing.entries()){
    if(ctrl.signal.aborted) break;
    setStatus(`Copying ${c.title} (${i+1} of ${missing.length})`);
    try{
     const res=await fetch(`/api/demo-clips/${encodeURIComponent(c.file)}`,{signal:ctrl.signal}); if(!res.ok) throw new Error(`HTTP ${res.status}`);
     const blob=await res.blob(); const duration=await durationOf(blob);
     const video:VideoRecord={id:idOf(c),title:c.title,recordedAt:new Date(now-i*1000).toISOString(),duration,source:"upload",analysis:"not_analyzed",blob,size:blob.size,detections:[]};
     await saveVideo(video); queue.push({video,blob});
    }catch(e){ if(!ctrl.signal.aborted) failed.push(`${c.title}: ${e instanceof Error?e.message:String(e)}`); }
   }
   if(analyze&&canAnalyze){
    for(const v of unanalysed) if(v.blob) queue.push({video:v,blob:v.blob});
    for(const [i,{video,blob}] of queue.entries()){
     if(ctrl.signal.aborted) break;
     const src=URL.createObjectURL(blob);
     try{
      const out=await analyzeRecording(video,src,p=>setStatus(`Analysing ${video.title} (${i+1} of ${queue.length}) · window ${Math.min(p.done+1,p.total)} of ${p.total}`),ctrl.signal);
      await saveVideo({...video,analysis:"complete",analysisModel:out.model,analysisError:out.failed?`${out.failed} window(s) could not be analysed.`:undefined,curatedAnalysis:out.curated,analyzedAt:new Date().toISOString(),detections:out.detections,moments:out.moments});
     }catch(e){ if(!ctrl.signal.aborted) failed.push(`${video.title}: ${e instanceof Error?e.message:String(e)}`); }
     finally{ URL.revokeObjectURL(src); }
    }
   }
   setStatus(ctrl.signal.aborted?"Cancelled. Clips copied so far stay in the library.":"Done.");
  }finally{ setErrors(failed); setRunning(false); abort.current=null; }
 }

 const todo=missing.length||(analyze&&canAnalyze&&unanalysed.length);
 return <div className="mb-6 rounded-xl border border-base-300 p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="min-w-0"><div className="text-sm font-medium">Demo clips</div>
    <p className="text-xs text-base-content/55 mt-0.5">{clips.length} UCF-Crime clips from this server ({clips.length-missing.length} in this browser, {unanalysed.length+missing.length} not analysed). Research-use footage.</p></div>
   <div className="flex items-center gap-3">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox checkbox-sm" checked={analyze} disabled={running||!canAnalyze} onChange={e=>setAnalyze(e.target.checked)}/>Analyse with {model?.model??"the model"}</label>
    {running?<button className="btn btn-outline btn-sm" onClick={()=>abort.current?.abort()}>Cancel</button>
     :<button className="btn btn-primary btn-sm" disabled={!todo} onClick={run}><Download size={15}/>{missing.length?`Load ${missing.length} clip${missing.length>1?"s":""}`:"Analyse the rest"}</button>}
   </div>
  </div>
  {status&&<p className="font-mono text-xs text-base-content/60 mt-3" role="status">{status}</p>}
  {errors.length>0&&<div className="mt-3"><Notice tone="error" role="alert">{errors.length} clip(s) failed: {errors.join(" · ")}. Check the model in Preferences and try again; finished clips are kept.</Notice></div>}
 </div>;
}
