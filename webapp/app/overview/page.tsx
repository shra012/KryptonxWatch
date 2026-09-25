"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, CloudUpload, MessageSquare, Phone, X } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { MonitorTile } from "@/components/monitor-tile";
import { ResponseDialog } from "@/components/response-dialog";
import { useTelemetry } from "@/components/use-telemetry";
import { EmptyState, EventLabel, EventTime, Notice, PageTitle, Panel, SeverityBadge, Sparkline } from "@/components/ui";
import { fetchAlertStatus, type AlertStatus } from "@/lib/alert-client";
import { responseFor, responsePriority } from "@/lib/response";
import { sameFootage, useFingerprints } from "@/lib/fingerprint";
import { allDetections, counts, uniqueFootage } from "@/lib/analytics";
import { dateLabel, isSecurityDetection, timeLabel, type Detection , type AlertRecipient, type ResponseRecord } from "@/lib/types";

/** One strip: what is waiting on a person, what the workspace holds, and whether
 *  the two machines behind it (the node, the SMS gateway) are actually up. */
function SystemBar({attention,figures,loading,edge,edgeDetail,alerts,alertDetail,alertOk}:{attention:number;figures:{label:string;value:number;href:string}[];loading:boolean;edge:"live"|"degraded"|"offline";edgeDetail:string;alerts:string;alertDetail:string;alertOk:boolean}){
 const clear=attention===0;
 const edgeTone=edge==="live"?"bg-base-content":edge==="degraded"?"bg-warning":"bg-error";
 return <section className="border border-base-300 rounded-xl overflow-hidden mb-10 flex flex-wrap" aria-label="System status">
  <div className={`flex items-center gap-4 px-6 py-5 border-r border-base-300 grow sm:grow-0 ${clear?"bg-base-200":"bg-warning/[.08]"}`}>
   <span className={`font-mono text-[2.6rem] leading-none font-bold tabular-nums ${clear?"text-base-content":"text-warning"}`}>{loading?"—":attention}</span>
   <span className="leading-tight">
    <span className="block font-mono text-[.58rem] uppercase tracking-[.08em] text-base-content/45">awaiting review</span>
    <span className="block text-sm font-medium mt-1.5">{clear?"All clear":"High priority"}</span>
   </span>
  </div>

  <div className="flex flex-1 flex-wrap min-w-0">
   {figures.map(({label,value,href})=><Link key={label} href={href} className="flex-1 min-w-[7.25rem] px-4 py-5 border-r border-base-300 last:border-r-0 hover:bg-base-200/60 transition-colors">
    <span className="block font-mono text-[.57rem] uppercase tracking-[.06em] text-base-content/45 truncate">{label}</span>
    <span className="block font-mono text-2xl font-semibold tabular-nums mt-1.5">{loading?<span className="text-base-content/25">—</span>:value}</span>
   </Link>)}
  </div>

  <div className="px-5 py-4 border-l border-base-300 min-w-[14.5rem] grow sm:grow-0 flex flex-col justify-center gap-2.5">
   <Link href="/system" title={edgeDetail} className="flex items-center gap-2.5 text-xs hover:text-primary transition-colors">
    <span className={`size-1.5 rounded-full shrink-0 ${edgeTone}`}/><span className="text-base-content/60">Edge node</span>
    <span className="ml-auto font-mono truncate">{edge==="live"?"live":edge==="degraded"?"host only":"unreachable"}</span>
   </Link>
   <Link href="/settings" title={alertDetail} className="flex items-center gap-2.5 text-xs hover:text-primary transition-colors">
    <span className={`size-1.5 rounded-full shrink-0 ${alertOk?"bg-base-content":"bg-base-content/25"}`}/><span className="text-base-content/60">Owner alerts</span>
    <span className="ml-auto font-mono truncate">{alerts}</span>
   </Link>
  </div>
 </section>;
}

type Row = Detection & { videoTitle: string; recordedAt: string; source: "sample" | "upload"; alertTo?: AlertRecipient };

/** An incident the owner can act on without leaving the page. */
function IncidentCard({d,onDismiss,onRespond}:{d:Row;onDismiss:()=>void;onRespond:()=>void}){
 const kind=responseFor(d.category);
 return <li className="border-l-2 border-base-300 hover:border-primary transition-colors pl-3.5 py-3">
  <div className="flex items-start justify-between gap-3">
   <Link href={`/videos/${d.videoId}?t=${Math.floor(d.seconds)}`} className="min-w-0 group">
    <span className="block font-medium text-sm truncate group-hover:text-primary"><EventLabel d={d}/></span>
    <span className="block text-xs text-base-content/50 truncate mt-0.5">{d.videoTitle} · <EventTime seconds={d.seconds}/> · {dateLabel(d.recordedAt)}</span>
   </Link>
   <SeverityBadge severity={d.severity}/>
  </div>
  <p className="text-xs text-base-content/55 mt-1.5 line-clamp-2">{d.description}</p>
  <div className="flex gap-1.5 mt-2.5">
   <button className="btn btn-xs btn-ghost gap-1" onClick={onDismiss}><X size={12}/>Dismiss</button>
   {d.response?<span className="inline-flex items-center gap-1 text-xs text-base-content/60 px-1"><Check size={12}/>{d.response.kind==="911"?"911 called":"Owner notified"} · {timeLabel(d.response.at)} · <span className="font-mono">{d.response.reference}</span></span>
    :kind==="911"?<button className="btn btn-xs btn-outline btn-error gap-1" onClick={onRespond}><Phone size={12}/>Call 911</button>
    :kind==="owner"&&<button className="btn btn-xs btn-outline btn-primary gap-1" onClick={onRespond}><MessageSquare size={12}/>Notify owner</button>}
  </div>
 </li>;
}

export default function Dashboard(){
 const {videos,loading,setReviewStatus,saveVideo}=useApp();
 const {snapshot,history,error}=useTelemetry(10000);
 const prints=useFingerprints(videos);
 const [alertState,setAlertState]=useState<AlertStatus|null>(null);
 const [responding,setResponding]=useState<Row|null>(null);
 const autoShown=useRef(false);
 const [note,setNote]=useState<{tone:"info"|"error";text:string}|null>(null);
 useEffect(()=>{const c=new AbortController();fetchAlertStatus(c.signal).then(setAlertState).catch(()=>{});return()=>c.abort();},[]);

 const stats=counts(videos);
 const all=allDetections(videos) as Row[];
 const attention=all.filter(d=>(d.severity==="critical"||d.severity==="high")&&d.status==="new").length;
 const open=all.filter(d=>d.status==="new").sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)||b.seconds-a.seconds);
 // Only recordings with a prominent crime (medium severity or above, not dismissed), each looping its most serious moment; worst first.
 const rank=(d:Detection)=>d.severity==="critical"?3:d.severity==="high"?2:d.severity==="medium"?1:0;
 const wall=uniqueFootage(videos,(a,b)=>sameFootage(prints[a.id],prints[b.id])).flatMap(v=>{const top=v.detections.filter(d=>isSecurityDetection(d)&&rank(d)>0).sort((a,b)=>rank(b)-rank(a)||(b.confidence??0)-(a.confidence??0))[0];return top?[{video:v,detection:top}]:[]})
  .sort((a,b)=>rank(b.detection)-rank(a.detection)||b.video.recordedAt.localeCompare(a.video.recordedAt));
 const edge=error?"offline":snapshot?.gpu?"live":"degraded";
 const edgeDetail=error?"No answer from /api/system":snapshot?.gpu?.name?`${snapshot.gpu.name} · ${Math.round(snapshot.gpu.utilisation??0)}% busy`:snapshot?"Accelerator not visible from this host":"Connecting…";
 const figures=[{label:"Recordings",value:stats.videos,href:"/videos"},{label:"Suspected incidents",value:stats.detections,href:"/detections"},{label:"High priority",value:stats.high,href:"/detections?severity=high"},{label:"Reviewed",value:stats.reviewed,href:"/detections?status=reviewed"},{label:"Queue metrics",value:stats.measurements,href:"/detections?severity=measurement"}];

 // Incidents still waiting for someone to call 911 or tell the owner, most urgent first. Low-severity "suspicious activity" never pops up.
 const pending=open.filter(d=>isSecurityDetection(d)&&!d.response&&responseFor(d.category)&&rank(d)>0).sort((a,b)=>responsePriority(b)-responsePriority(a));
 // Pop up only for incidents that are new since the last visit (e.g. an analysis just found a robbery), the most
 // urgent of them, once. The backlog never pops up; it waits in the open incidents list with Call 911 / Notify owner.
 // The first visit in a browser only records what is already there.
 useEffect(()=>{
  if(loading||autoShown.current)return;
  autoShown.current=true;
  let seen:string[]|null=null;try{seen=JSON.parse(localStorage.getItem("sm-response-seen")??"null")}catch{}
  const fresh=seen?pending.filter(d=>!seen.includes(d.id)):[];
  try{localStorage.setItem("sm-response-seen",JSON.stringify([...new Set([...(seen??[]),...pending.map(d=>d.id)])].slice(-1000)))}catch{}
  if(fresh[0])setResponding(fresh[0]);
 },[loading,pending]);
 const recordResponse=async(d:Row,record:ResponseRecord)=>{const v=videos.find(x=>x.id===d.videoId);if(!v)return;
  try{await saveVideo({...v,detections:v.detections.map(x=>x.id===d.id?{...x,response:record}:x)});fetchAlertStatus().then(setAlertState).catch(()=>{});}
  catch(e){setNote({tone:"error",text:e instanceof Error?e.message:"Could not save the response."})}};
 const closeResponse=()=>setResponding(null);
 const dismiss=async(d:Row)=>{try{await setReviewStatus(d.videoId,d.id,"dismissed")}catch(e){setNote({tone:"error",text:e instanceof Error?e.message:"Could not dismiss this detection."})}};

 return <>
 <PageTitle eyebrow="Monitor" title="Overview" description="Every flagged crime, looping at the moment it happened, and what is still waiting on a person."
  action={<Link href="/upload" className="btn btn-primary btn-sm"><CloudUpload size={16}/>Upload video</Link>}/>

 <SystemBar attention={attention} figures={figures} loading={loading} edge={edge} edgeDetail={edgeDetail}
  alerts={alertState?(alertState.configured?"armed":"off"):"…"}
  alertDetail={alertState?.configured?`Texting ${alertState.ownerMasked} · ${alertState.sentLastHour}/${alertState.maxPerHour} sent this hour`:"No owner number is set yet"}
  alertOk={alertState?.configured??false}/>

 {note&&<div className="mb-6"><Notice tone={note.tone} role={note.tone==="error"?"alert":undefined}>{note.text}</Notice></div>}

 <Panel title="Monitor wall" action={<Link href="/videos" className="text-sm link link-primary link-hover">Library</Link>}>
  {wall.length?<>
   <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))]">{wall.map(({video,detection},index)=><MonitorTile key={video.id} video={video} detection={detection} index={index}/>)}</div>
   <p className="text-xs text-base-content/45 mt-3">Recordings with a suspected crime of medium severity or above. Each tile loops the flagged moment with the tracked person boxed; open it to review.</p>
  </>:videos.length?<EmptyState title="No crimes flagged" description="Run AI analysis on a recording. Anything it flags at medium severity or above loops here." action={<Link href="/videos" className="btn btn-primary btn-sm">Video library</Link>}/>
  :<EmptyState title="No recordings" description="Upload a video and run AI analysis. Flagged crimes loop on the wall." action={<Link href="/upload" className="btn btn-primary btn-sm">Upload video</Link>}/>}
 </Panel>

 <div className="grid xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-x-8 gap-y-10 items-start mt-10">
  <Panel title="Open incidents" action={<Link href="/detections" className="text-sm link link-primary link-hover">Full log</Link>}>
    {open.length?<ul className="space-y-1">{open.slice(0,6).map(d=>
     <IncidentCard key={d.id} d={d} onRespond={()=>setResponding(d)} onDismiss={()=>dismiss(d)}/>)}</ul>
    :<EmptyState title="Nothing open" description="Every annotation has been reviewed or dismissed."/>}
    {open.length>6&&<Link href="/detections" className="block text-xs text-base-content/50 hover:text-primary mt-3 pl-3.5">{open.length-6} more in the log →</Link>}
   </Panel>

  <Panel title="Edge node" action={<Link href="/system" className="text-sm link link-primary link-hover">Telemetry</Link>}>
    {error?<Notice tone="error" role="alert">{error}</Notice>
    :<div className="space-y-4">
     <div><div className="flex items-baseline justify-between"><span className="text-sm text-base-content/60">GPU utilisation</span><span className="font-mono text-2xl font-semibold tabular-nums">{snapshot?.gpu?.utilisation==null?"—":`${Math.round(snapshot.gpu.utilisation)}%`}</span></div><Sparkline values={history.map(p=>p.gpu)} label="GPU utilisation" height={34}/></div>
     <div><div className="flex items-baseline justify-between"><span className="text-sm text-base-content/60">CPU load</span><span className="font-mono text-2xl font-semibold tabular-nums">{snapshot?.host.cpuLoad==null?"—":`${Math.round(snapshot.host.cpuLoad)}%`}</span></div><Sparkline values={history.map(p=>p.cpu)} tone="text-secondary" label="CPU load" height={34}/></div>
     <dl className="text-xs space-y-1.5 pt-1">
      <div className="flex justify-between gap-3"><dt className="text-base-content/50">Node</dt><dd className="font-mono truncate">{snapshot?.host.hostname??"—"}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-base-content/50">Accelerator</dt><dd className="font-mono truncate">{snapshot?.gpu?.name??"none visible"}</dd></div>
     </dl>
    </div>}
  </Panel>
 </div>

 <div className="mt-10"><Notice tone="muted">Bundled recordings and their detection annotations are simulated. Uploaded videos stay in this browser and receive no automated analysis until a detection service is connected.</Notice></div>
 {responding&&<ResponseDialog incident={{detection:responding,place:responding.videoTitle,sample:responding.source==="sample",recipient:responding.alertTo}} alertStatus={alertState}
  more={pending.filter(d=>d.id!==responding.id).length} onDone={r=>recordResponse(responding,r)} onClose={closeResponse}/>}
 </>;
}
