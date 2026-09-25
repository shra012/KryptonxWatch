"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { EmptyState, EventLabel, Notice, PageTitle, Panel, SeverityBadge } from "@/components/ui";
import { allDetections, categoryChart, counts, downloadCsv, severityChart, trendChart, videoChart } from "@/lib/analytics";
import { Sparkles } from "lucide-react";
import { requestSummary, useModelStatus } from "@/lib/detection-client";
import { dateLabel, severityOrder, type Severity, type VideoRecord } from "@/lib/types";

// The ramp lives in globals.css so each theme gets its own checked steps.
const sevColor: Record<Severity,string> = { critical:"var(--sev-critical)", high:"var(--sev-high)", medium:"var(--sev-medium)", low:"var(--sev-low)", measurement:"var(--sev-metric)" };
const axis = { fill:"var(--color-base-content)", fillOpacity:.5, fontSize:11 };

/** The model's read of the analysed uploads. Simulated samples are excluded: a
 *  summary that blended real findings with demo annotations would be worthless. */
function AiSummary({videos,fallback}:{videos:VideoRecord[];fallback:string}){
 const model=useModelStatus();
 const [text,setText]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 async function generate(){
  setBusy(true); setError("");
  try{
   const analysed=videos.filter(v=>v.source==="upload"&&v.analysis==="complete");
   if(!analysed.length){setError("No AI-analysed recordings yet. Upload a video and run analysis first; simulated samples are not summarised.");return;}
   const rows=allDetections(analysed).filter(d=>d.status!=="dismissed").map(d=>({video:d.videoTitle,seconds:d.seconds,category:d.category,severity:d.severity,status:d.status,description:d.description}));
   setText((await requestSummary(rows,counts(analysed))).summary);
  }catch(e){setError(e instanceof Error?e.message:"Could not generate a summary.");}
  finally{setBusy(false);}
 }
 return <Panel title={text?"Model summary":"Summary"} action={model?.configured&&<button className="btn btn-outline btn-xs" onClick={generate} disabled={busy}>{busy?<span className="loading loading-spinner loading-xs"/>:<Sparkles size={13}/>}{text?"Regenerate":"Generate"}</button>}>
  {text?<><p className="whitespace-pre-wrap text-base-content/80 leading-relaxed">{text}</p>
   <p className="font-mono text-[.62rem] uppercase tracking-[.14em] text-base-content/40 mt-3">{model?.chatModel??model?.model} · analysed uploads only</p></>
  :<p className="text-base-content/70 leading-relaxed">{fallback}</p>}
  {error&&<div className="mt-3"><Notice tone="error" role="alert">{error}</Notice></div>}
 </Panel>;
}

/** Recharts' default tooltip is a white box; this one wears the theme. */
function ChartTip({active,payload,label,unit="incidents"}:{active?:boolean;payload?:{value?:number}[];label?:string|number;unit?:string}){
 if(!active||!payload?.length) return null;
 return <div className="bg-base-100 border border-base-300 rounded-lg px-3 py-2 text-xs shadow-lg">
  <div className="font-medium">{label}</div>
  <div className="font-mono tabular-nums text-base-content/70 mt-0.5">{payload[0]?.value} {unit}</div>
 </div>;
}

/** Part-to-whole across an ordered scale: one bar, stepped by lightness, labelled. */
function SeverityMix({data,total}:{data:{name:string;value:number}[];total:number}){
 const ordered=severityOrder.map(s=>({severity:s,value:data.find(d=>d.name===s)?.value??0})).filter(d=>d.value>0);
 if(!total) return <EmptyState title="No annotations" description="Severity appears once a recording carries annotations."/>;
 return <div>
  <div className="flex gap-[2px] h-11 rounded-md overflow-hidden" role="img" aria-label={ordered.map(d=>`${d.severity}: ${d.value}`).join(", ")}>
   {ordered.map(d=><div key={d.severity} className="grid place-items-center min-w-[2px]" style={{flexGrow:d.value,background:sevColor[d.severity]}}
     title={`${d.severity}: ${d.value}`}>
    {d.value/total>=.12&&<span className="font-mono text-xs font-semibold" style={{color:d.severity==="measurement"?"var(--color-base-content)":d.severity==="low"?"var(--color-base-100)":"var(--color-base-100)"}}>{d.value}</span>}
   </div>)}
  </div>
  <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4">
   {ordered.map(d=><li key={d.severity} className="flex items-center gap-2 text-sm">
    <span className="size-2.5 rounded-[3px] shrink-0" style={{background:sevColor[d.severity]}}/>
    <span className="capitalize text-base-content/70">{d.severity==="measurement"?"Queue metric":d.severity}</span>
    <span className="font-mono tabular-nums text-base-content/50">{Math.round(d.value/total*100)}%</span>
   </li>)}
  </ul>
 </div>;
}

export default function Analytics(){
 const {videos}=useApp();
 const [sort,setSort]=useState("newest");
 const [category,setCategory]=useState("all");
 const stats=counts(videos);
 const byCategory=[...categoryChart(videos)].sort((a,b)=>b.value-a.value);
 const bySeverity=severityChart(videos), byVideo=videoChart(videos), trend=trendChart(videos);
 const severityTotal=bySeverity.reduce((n,d)=>n+d.value,0);
 const rows=useMemo(()=>allDetections(videos).filter(d=>d.status!=="dismissed"&&(category==="all"||d.category===category))
  .sort((a,b)=>sort==="oldest"?a.recordedAt.localeCompare(b.recordedAt)||a.seconds-b.seconds
   :sort==="severity"?severityOrder.indexOf(a.severity)-severityOrder.indexOf(b.severity)
   :b.recordedAt.localeCompare(a.recordedAt)||b.seconds-a.seconds),[videos,sort,category]);
 const figures=[{label:"Recordings",value:stats.videos},{label:"Suspected incidents",value:stats.detections},{label:"High priority",value:stats.high},{label:"Reviewed",value:stats.reviewed},{label:"Queue measurements",value:stats.measurements}];

 return <>
 <PageTitle hero eyebrow="Recorded insights" title="Analytics" description="Where the annotations fall across recordings, categories and time. Everything here derives from the annotations in this browser."
  action={<button className="btn btn-outline btn-sm" disabled={!rows.length} onClick={()=>downloadCsv(rows)}><Download size={15}/>Export filtered CSV</button>}/>

 <div className="mb-10"><AiSummary videos={videos} fallback={stats.detections
  ? `${stats.detections} suspected incidents across ${stats.videos} recordings, of which ${stats.high} are high priority and ${stats.reviewed} reviewed. ${stats.measurements} queue measurements are counted separately because a queue is not an incident.${videos.some(v=>v.analysis==="complete")?" Uploads include model findings; bundled samples are simulated.":" Every figure comes from simulated sample annotations."}`
  : "No suspected incidents are available. Uploads need a connected detection service before analytics can include findings."}/></div>

 {!videos.length?<EmptyState title="No recordings" description="Add a recording to start building your workspace." action={<Link href="/upload" className="btn btn-primary btn-sm">Upload video</Link>}/>
 :<>
  <div className="flex flex-wrap border border-base-300 rounded-xl overflow-hidden mb-10">
   {figures.map(({label,value})=><div key={label} className="flex-1 min-w-[8.5rem] px-5 py-4 border-r border-base-300 last:border-r-0">
    <span className="block font-mono text-[.57rem] uppercase tracking-[.14em] text-base-content/45">{label}</span>
    <span className="block font-mono text-2xl font-semibold tabular-nums mt-1.5">{value}</span>
   </div>)}
  </div>

  <div className="grid xl:grid-cols-2 gap-x-8 gap-y-10 mb-10 items-start">
   <Panel title="Severity mix" action={<span className="text-xs text-base-content/45">{severityTotal} annotations</span>}>
    <SeverityMix data={bySeverity} total={severityTotal}/>
   </Panel>

   <Panel title="By category">
    {byCategory.length?<div style={{height:Math.max(160,byCategory.length*30+20)}}>
     <ResponsiveContainer width="100%" height="100%">
      <BarChart data={byCategory} layout="vertical" margin={{left:0,right:16,top:4,bottom:4}}>
       <CartesianGrid stroke="var(--color-base-300)" horizontal={false}/>
       <XAxis type="number" allowDecimals={false} tick={axis} axisLine={false} tickLine={false}/>
       <YAxis type="category" dataKey="name" width={124} tick={axis} axisLine={false} tickLine={false}/>
       <Tooltip cursor={{fill:"var(--color-base-200)"}} content={<ChartTip/>}/>
       <Bar dataKey="value" fill="var(--color-primary)" radius={[0,4,4,0]} barSize={14} isAnimationActive={false}/>
      </BarChart>
     </ResponsiveContainer>
    </div>:<EmptyState title="No annotations" description="Charts appear when annotated recordings are available."/>}
   </Panel>

   <Panel title="By recording">
    {byVideo.length?<div style={{height:Math.max(160,byVideo.length*34+20)}}>
     <ResponsiveContainer width="100%" height="100%">
      <BarChart data={byVideo} layout="vertical" margin={{left:0,right:16,top:4,bottom:4}}>
       <CartesianGrid stroke="var(--color-base-300)" horizontal={false}/>
       <XAxis type="number" allowDecimals={false} tick={axis} axisLine={false} tickLine={false}/>
       <YAxis type="category" dataKey="name" width={124} tick={axis} axisLine={false} tickLine={false}/>
       <Tooltip cursor={{fill:"var(--color-base-200)"}} content={<ChartTip/>}/>
       <Bar dataKey="value" fill="var(--color-secondary)" radius={[0,4,4,0]} barSize={14} isAnimationActive={false}/>
      </BarChart>
     </ResponsiveContainer>
    </div>:<EmptyState title="No recordings" description="Nothing to chart yet."/>}
   </Panel>

   <Panel title="By recording date">
    {trend.length>1?<div className="chart-wrap">
     <ResponsiveContainer width="100%" height="100%">
      <LineChart data={trend} margin={{left:0,right:16,top:8,bottom:4}}>
       <CartesianGrid stroke="var(--color-base-300)" vertical={false}/>
       <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false}/>
       <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} width={28}/>
       <Tooltip cursor={{stroke:"var(--color-base-300)"}} content={<ChartTip/>}/>
       <Line dataKey="value" stroke="var(--color-primary)" strokeWidth={2} dot={{r:4,fill:"var(--color-primary)",strokeWidth:0}} activeDot={{r:6}} isAnimationActive={false}/>
      </LineChart>
     </ResponsiveContainer>
    </div>:<EmptyState title="Not enough dates" description="A trend needs recordings from more than one day."/>}
   </Panel>
  </div>

  <Panel title="Annotation details" action={<div className="flex gap-2">
    <select className="select select-sm" value={category} onChange={e=>setCategory(e.target.value)} aria-label="Filter analytics category"><option value="all">All categories</option>{byCategory.map(x=><option key={x.name}>{x.name}</option>)}</select>
    <select className="select select-sm" value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sort analytics rows"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="severity">Severity</option></select>
   </div>}>
   {rows.length?<div className="overflow-x-auto"><table className="table table-sm">
    <thead><tr><th>Recording</th><th>Recorded</th><th>Event</th><th>Severity</th><th>Review</th></tr></thead>
    <tbody>{rows.map(d=><tr key={d.id}>
     <td><Link href={`/videos/${d.videoId}?t=${d.seconds}`} className="link link-primary link-hover">{d.videoTitle}</Link></td>
     <td className="whitespace-nowrap">{dateLabel(d.recordedAt)}</td>
     <td><EventLabel d={d}/></td>
     <td><SeverityBadge severity={d.severity}/></td>
     <td className="capitalize text-base-content/60">{d.status}</td>
    </tr>)}</tbody>
   </table></div>:<EmptyState title="No matching annotations" description="Try another category."/>}
  </Panel>

 </>}

 </>;
}
