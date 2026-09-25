"use client";
import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, MessageSquare, Moon, ShieldAlert, Sun } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { DeviceMetric, Hint, Notice, PageTitle, Panel } from "@/components/ui";
import { fetchAlertStatus, sendTestAlert, type AlertResult, type AlertStatus } from "@/lib/alert-client";
import { setSelectedModel, useModelStatus } from "@/lib/detection-client";
import { isScorerModel, modelLabel } from "@/lib/vlm/scorer";
import { categories, severityOrder } from "@/lib/types";

const alwaysAlert = ["Gun", "Robbery", "Medical emergency"];
const neverAlert = ["Queue tracking"];
const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, measurement: 0 };

function Toggle({checked,onChange,title,description}:{checked:boolean;onChange:(v:boolean)=>void;title:string;description:string}){
 return <label className="flex items-start justify-between gap-5 cursor-pointer py-3.5 border-b border-base-300 last:border-0">
  <span><span className="block font-medium">{title}</span><span className="block text-sm text-base-content/55 mt-0.5">{description}</span></span>
  <input type="checkbox" className="toggle toggle-primary toggle-sm mt-1 shrink-0" checked={checked} onChange={e=>onChange(e.target.checked)}/>
 </label>;
}

/** Which categories would actually wake the owner, given the configured floor. */
function RuleMatrix({floor}:{floor:string}){
 return <div className="overflow-x-auto"><table className="table table-xs">
  <thead><tr><th>Category</th>{severityOrder.map(s=><th key={s} className="text-center capitalize font-normal">{s==="measurement"?"metric":s}</th>)}</tr></thead>
  <tbody>{categories.map(c=><tr key={c}>
   <td className={`whitespace-nowrap ${neverAlert.includes(c)?"text-base-content/40":""}`}>{c}{alwaysAlert.includes(c)&&<span className="ml-1.5 font-mono text-[.58rem] uppercase tracking-wider text-error">always</span>}{neverAlert.includes(c)&&<span className="ml-1.5 font-mono text-[.58rem] uppercase tracking-wider text-base-content/40">never</span>}</td>
   {severityOrder.map(s=>{const on=s!=="measurement"&&!neverAlert.includes(c)&&(alwaysAlert.includes(c)||rank[s]>=rank[floor]);
    return <td key={s} className="text-center"><span className={`inline-block size-2 rounded-full ${on?"bg-primary":"bg-base-300"}`} aria-label={on?`${c} at ${s} severity texts the owner`:`${c} at ${s} severity does not text`}/></td>;})}
  </tr>)}</tbody>
 </table></div>;
}

function AlertsPanel(){
 const {smsAlerts,setSmsAlerts}=useApp();
 const [status,setStatus]=useState<AlertStatus|null>(null);
 const [statusError,setStatusError]=useState("");
 const [result,setResult]=useState<AlertResult|null>(null);
 const [sending,setSending]=useState(false);
 const load=useCallback((signal?:AbortSignal)=>fetchAlertStatus(signal).then(s=>{setStatus(s);setStatusError("")}).catch(e=>{if((e as Error).name!=="AbortError")setStatusError((e as Error).message)}),[]);
 useEffect(()=>{const c=new AbortController();load(c.signal);return()=>c.abort();},[load]);
 const test=async()=>{setSending(true);setResult(await sendTestAlert());setSending(false);load();};

 if(statusError) return <Panel title="Owner SMS alerts"><Notice tone="error" role="alert">{statusError}</Notice></Panel>;
 if(!status) return <Panel title="Owner SMS alerts"><p className="text-sm text-base-content/50">Checking the alert service…</p></Panel>;
 const used=status.maxPerHour?status.sentLastHour/status.maxPerHour:null;

 return <>
 <div className="flex flex-wrap border border-base-300 rounded-2xl overflow-hidden mb-4">
  <DeviceMetric label="Twilio" help="Whether the server holds a complete set of Twilio credentials and an owner number." value={status.configured?"Ready":"Off"} fraction={status.configured?1:0} caption={status.configured?"Credentials loaded from .env.local.":`Missing ${status.missing.length} setting${status.missing.length===1?"":"s"}.`} tone={status.configured?"bg-success":"bg-warning"}/>
  <DeviceMetric label="Owner number" help="Where a text goes. Stored on the server; shown here partly masked." value={status.ownerMasked??null} fraction={status.ownerMasked?1:0} caption={status.ownerMasked?"E.164, verified against Twilio at send time.":"Set ALERT_OWNER_NUMBER to arm alerting."}/>
  <DeviceMetric label="Sent this hour" help="A rolling one-hour window. The cap protects the owner from a storm of texts and the account from a storm of charges." value={status.sentLastHour} unit={`/ ${status.maxPerHour}`} fraction={used} caption={status.sentLastHour>=status.maxPerHour?"Cap reached; further alerts wait.":`${status.maxPerHour-status.sentLastHour} left before the cap.`} tone={(used??0)>=.8?"bg-warning":"bg-primary"}/>
  <DeviceMetric label="Severity floor" help="Anything below this severity is logged but not texted. Gun, robbery and medical emergency override it." value={status.minimumSeverity} fraction={rank[status.minimumSeverity]/4} caption="Set with ALERT_MIN_SEVERITY."/>
  <DeviceMetric label="Endpoint" help="Where the message is actually posted. A non-Twilio base is a local fake, used by the tests so nothing is billed." value={status.sandbox?"Fake":"Twilio"} fraction={1} caption={status.sandbox?"TWILIO_API_BASE is overridden. Nothing is billed.":"Live Twilio REST API."} tone={status.sandbox?"bg-secondary":"bg-primary"}/>
 </div>

 {!status.configured&&<div className="mb-6"><Notice tone="warning">No text will go out until <span className="font-mono text-xs">{status.missing.join(", ")}</span> {status.missing.length===1?"is":"are"} set in <span className="font-mono text-xs">webapp/.env.local</span> and the server is restarted. <span className="font-mono text-xs">.env.local.example</span> lists every variable.</Notice></div>}

 <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-x-8 gap-y-8 items-start">
  <Panel title="Behaviour">
   <Toggle checked={smsAlerts} onChange={setSmsAlerts} title="Text during playback" description="When a simulated event passes while you watch a sample recording, text the owner as well as showing the in-app notice. Off by default: sample footage is not a real incident."/>
   <div className="pt-4">
    <div className="flex flex-wrap items-center gap-3">
     <button className="btn btn-primary btn-sm" onClick={test} disabled={sending}>{sending?<Loader2 size={15} className="animate-spin"/>:<MessageSquare size={15}/>}Send a test text</button>
     <span className="text-xs text-base-content/50">Goes to the owner number and counts against the cap.</span>
    </div>
    {result&&<div className="mt-4"><Notice tone={result.outcome==="sent"?"info":"error"} role={result.outcome==="sent"?undefined:"alert"}>{result.message}
     {result.body&&<span className="block font-mono text-xs text-base-content/50 mt-2 border-l border-base-300 pl-2.5">{result.body}<span className="block text-base-content/35 mt-1">{result.body.length}/160 characters · one billed segment</span></span>}</Notice></div>}
   </div>
   <dl className="mt-6 pt-5 border-t border-base-300 text-sm space-y-2.5">
    <div className="flex gap-3"><dt className="text-base-content/50 w-32 shrink-0">Deduplication <Hint text="The server remembers which detections it has already texted about, so a second click on the same event is refused."/></dt><dd>One text per detection</dd></div>
    <div className="flex gap-3"><dt className="text-base-content/50 w-32 shrink-0">Message <Hint text="A longer body would split into two billed segments, so the review link is trimmed before the text is."/></dt><dd>Plain text, 160 characters</dd></div>
    <div className="flex gap-3"><dt className="text-base-content/50 w-32 shrink-0">Sample footage</dt><dd>Prefixed <span className="font-mono text-xs">[SIMULATED]</span></dd></div>
   </dl>
  </Panel>

  <Panel title="Alert rules" action={<span className="text-xs text-base-content/45">floor: {status.minimumSeverity}</span>}>
   <RuleMatrix floor={status.minimumSeverity}/>
   <p className="text-xs text-base-content/50 mt-3 flex items-start gap-2"><ShieldAlert size={14} className="text-error mt-0.5 shrink-0"/>A gun, a robbery or a medical emergency texts the owner at any severity. Queue tracking never does — it is a measurement, not an incident.</p>
  </Panel>
 </div>
 </>;
}

/** Which model analyses footage. The key stays on the server; this only names it. */
function ModelPanel(){
 const model=useModelStatus();
 if(!model) return <Panel title="Analysis model"><p className="text-sm text-base-content/50">Asking the server which model is configured…</p></Panel>;
 if(!model.configured) return <Panel title="Analysis model"><Notice tone="warning" role="alert">No model is configured. Set <span className="font-mono text-xs">VLM_BASE_URL</span> and <span className="font-mono text-xs">VLM_MODEL</span> in <span className="font-mono text-xs">webapp/.env.local</span> and restart the server.</Notice></Panel>;
 return <Panel title="Analysis model" action={<span className="font-mono text-[.62rem] uppercase tracking-[.14em] text-base-content/45">{model.provider}</span>}>
  {(model.options?.length??0)>1
   ? <label className="block"><span className="block text-sm text-base-content/60 mb-1.5">Model for analysis, assistant and summary</span>
      <select className="select select-sm w-full" value={model.model} onChange={e=>setSelectedModel(e.target.value)} aria-label="Analysis model">
       {model.options!.map(m=><option key={m} value={m}>{modelLabel(m)}</option>)}</select>
      <span className="block text-xs text-base-content/45 mt-1.5">Saved in this browser. Re-run analysis on a recording to compare models.</span></label>
   : <p className="font-mono text-sm">{model.model}</p>}
  {isScorerModel(model.model)&&<div className="mt-4"><Notice tone="warning">This is a local scorer: it runs on the GB10 and answers only whether shoplifting occurs in each 8-second clip (16 frames at 2 fps). It works on recorded video, not the live monitor, and gives no location in the frame. Its own README reports many false positives on normal footage, so review every detection it raises.</Notice></div>}
  {model.chatModel&&model.chatModel!==model.model&&<p className="text-sm text-base-content/60 mt-3">Assistant runs on <span className="font-mono text-xs">{model.chatModel}</span>.</p>}
  <p className="text-sm text-base-content/55 mt-4">Configured on the server in <span className="font-mono text-xs">webapp/.env.local</span>. Point <span className="font-mono text-xs">VLM_BASE_URL</span> at a local OpenAI-compatible server to keep inference on the GB10.</p>
 </Panel>;
}

export default function Settings(){
 const {theme,setTheme,alerts,setAlerts}=useApp();
 return <>
 <PageTitle hero eyebrow="Workspace" title="Preferences" description="How this browser shows the workspace, and who gets told when something happens."/>

 <div className="space-y-12">
  <AlertsPanel/>

  <div className="grid lg:grid-cols-3 gap-x-8 gap-y-8 items-start">
   <ModelPanel/>
   <Panel title="Appearance">
    <div className="flex gap-2">{([["light","Light",Sun],["dark","Dark",Moon]] as const).map(([value,label,Icon])=>
     <button key={value} className={`btn btn-sm flex-1 ${theme===value?"btn-primary":"btn-outline"}`} onClick={()=>setTheme(value)}><Icon size={15}/>{label}</button>)}</div>
    <p className="text-xs text-base-content/50 mt-3">Stored in this browser. Teal reads all clear, amber reads attention.</p>
   </Panel>

   <Panel title="Playback alerts">
    <Toggle checked={alerts} onChange={setAlerts} title="In-app incident alerts" description="Show a notice as simulated events pass during sample playback."/>
    <p className="text-xs text-base-content/50 pt-3 flex items-start gap-2"><Bell size={14} className="text-primary mt-0.5 shrink-0"/>A screen notice only. Texting is configured above.</p>
   </Panel>

   <Panel title="Data and privacy">
    <p className="text-sm text-base-content/60">Uploaded videos and review choices live in this browser. Clearing site data removes them. Sample videos and annotations are simulated. When you run analysis, sampled frames are sent to the configured model server.</p>
    <p className="text-sm text-base-content/60 mt-3">Twilio credentials stay in <span className="font-mono text-xs">webapp/.env.local</span> on the server and are never sent to this page.</p>
   </Panel>
  </div>
 </div>
 </>;
}
