"use client";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileVideo, Info, X } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Notice, PageTitle, Panel } from "@/components/ui";
import { fetchAlertStatus, sendRecipientTest, type AlertStatus } from "@/lib/alert-client";
import { alertChannels, type AlertChannel, type AlertRecipient } from "@/lib/types";
import { useModelStatus } from "@/lib/detection-client";
import { newId } from "@/lib/id";
const maxBytes=250*1024*1024;
export default function UploadPage(){const router=useRouter();const {saveVideo}=useApp();const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState("");const [title,setTitle]=useState("");const [duration,setDuration]=useState(0);const [error,setError]=useState("");const [saving,setSaving]=useState(false);const [dragging,setDragging]=useState(false);const input=useRef<HTMLInputElement>(null);const model=useModelStatus();const [analyze,setAnalyze]=useState(true);
const [alertStatus,setAlertStatus]=useState<AlertStatus|null>(null);
const [channel,setChannel]=useState<AlertChannel|"">("");
const [contact,setContact]=useState("");
const [contactError,setContactError]=useState("");
const [testNote,setTestNote]=useState<{tone:"info"|"error";text:string}|null>(null);
const [testing,setTesting]=useState(false);
useEffect(()=>{const c=new AbortController();fetchAlertStatus(c.signal).then(setAlertStatus).catch(()=>{});return()=>c.abort()},[]);
// The same check the server runs, so a typo is caught before the recording is saved.
function recipient():AlertRecipient|undefined{return channel&&contact.trim()?{channel,to:contact.trim()}:undefined}
function validate(){const r=recipient();if(!r)return true;const ok=r.channel==="email"?/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.to):/^\+[1-9]\d{7,14}$/.test(r.to.replace(/[\s()\-.]/g,""));setContactError(ok?"":r.channel==="email"?"That does not look like an email address.":"Use international form, for example +14085551234.");return ok}
async function testAlert(){const r=recipient();if(!r||!validate())return;setTesting(true);const res=await sendRecipientTest(r,title.trim()||"this recording");setTesting(false);setTestNote({tone:res.outcome==="sent"?"info":"error",text:res.message})}
useEffect(()=>{if(!file)return;const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file]);
function choose(f?:File){setError("");setDuration(0);if(!f)return;if(!["video/mp4","video/webm"].includes(f.type)&&!/(\.mp4|\.webm)$/i.test(f.name)){setError("Choose an MP4 or WebM video.");return}if(f.size>maxBytes){setError("This file exceeds the 250 MB browser-storage limit. Choose a smaller recording.");return}setFile(f);setTitle(f.name.replace(/\.(mp4|webm)$/i,""));}
function drop(e:DragEvent){e.preventDefault();setDragging(false);choose(e.dataTransfer.files[0]);}
async function save(){if(!validate())return;if(!file||!Number.isFinite(duration)||duration<=0){setError("The video cannot be played or its duration is unavailable. Try a browser-compatible MP4 or WebM file.");return}if(!title.trim()){setError("Enter a name for this recording.");return}setSaving(true);setError("");try{const id=newId();await saveVideo({id,title:title.trim(),recordedAt:new Date().toISOString(),duration,source:"upload",analysis:"not_analyzed",blob:file,size:file.size,detections:[],alertTo:recipient()});router.push(`/videos/${id}${analyze&&model?.configured?"?analyze=1":""}`)}catch(e){setError(e instanceof Error?e.message:"Could not save this video.")}finally{setSaving(false)}}
return <><PageTitle eyebrow="Add recording" title="Upload a video" description="Keep a local copy in this browser for playback and manual review."/>
<div className="grid xl:grid-cols-[1.4fr_.6fr] gap-6"><Panel><input ref={input} type="file" accept="video/mp4,video/webm,.mp4,.webm" className="sr-only" onChange={(e:ChangeEvent<HTMLInputElement>)=>choose(e.target.files?.[0])}/><div onDragEnter={e=>{e.preventDefault();setDragging(true)}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{e.preventDefault();setDragging(false)}} onDrop={drop} className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${dragging?"border-primary bg-primary/10":"border-base-300 bg-base-200/50"}`}><CloudUpload className="mx-auto text-primary mb-4" size={36}/><div className="font-semibold text-lg">Drop a recording here</div><p className="text-base-content/60 text-sm mt-1 mb-5">MP4 or WebM · up to 250 MB</p><button className="btn btn-primary" onClick={()=>input.current?.click()}>Choose file</button></div>
{file&&<div className="mt-6"><div className="flex items-center justify-between gap-3 mb-4"><div className="flex gap-2 items-center min-w-0"><FileVideo size={18} className="text-primary"/><span className="truncate font-medium">{file.name}</span><span className="text-xs text-base-content/50 shrink-0">{(file.size/1024/1024).toFixed(1)} MB</span></div><button className="btn btn-ghost btn-sm btn-circle" aria-label="Remove selected file" onClick={()=>{setFile(null);setPreview("");if(input.current)input.current.value=""}}><X size={16}/></button></div><video className="w-full rounded-xl bg-black max-h-96" src={preview||undefined} controls preload="metadata" onLoadedMetadata={e=>setDuration(e.currentTarget.duration)} onError={()=>setError("This file cannot be played in your browser. Try another MP4 or WebM encoding.")}/><label className="fieldset mt-5"><span className="fieldset-legend">Recording name</span><input className="input w-full" value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} placeholder="e.g. Store entrance · 10:15"/></label>{model?.configured&&<label className="flex items-center gap-3 mt-4 cursor-pointer text-sm"><input type="checkbox" className="checkbox checkbox-primary checkbox-sm" checked={analyze} onChange={e=>setAnalyze(e.target.checked)}/>Run AI analysis after saving ({model.model})</label>}<fieldset className="mt-6 border-t border-base-300 pt-5">
 <legend className="sr-only">Alert someone about this recording</legend>
 <div className="font-mono text-[.62rem] uppercase tracking-[.16em] text-base-content/45 mb-3">Tell someone when this flags</div>
 {alertStatus&&!alertStatus.acceptsRecipient
  ? <p className="text-sm text-base-content/55">This server sends alerts only to the owner number it is configured with.</p>
  : <>
   <div className="flex flex-wrap gap-2">
    {([["","Nobody"],...alertChannels.map(c=>[c.value,c.label] as const)] as [AlertChannel|"",string][]).map(([value,label])=>{
     const off=value!==""&&alertStatus&&!alertStatus.channels[value as AlertChannel];
     return <button key={value||"none"} type="button" onClick={()=>{setChannel(value);setContactError("");setTestNote(null)}} disabled={!!off}
      title={off?`${label} is not configured on this server.`:undefined}
      className={`btn btn-sm ${channel===value?"btn-primary":"btn-outline"} ${off?"btn-disabled opacity-40":""}`}>{label}</button>;
    })}
   </div>
   {channel&&<div className="mt-3">
    <label className="block"><span className="block text-sm text-base-content/60 mb-1.5">{alertChannels.find(c=>c.value===channel)?.hint}</span>
     <div className="flex gap-2">
      <input className="input input-sm flex-1" value={contact} onChange={e=>{setContact(e.target.value);setContactError("")}}
       placeholder={alertChannels.find(c=>c.value===channel)?.placeholder} aria-label={`Where to send ${channel} alerts`} maxLength={120}
       inputMode={channel==="email"?"email":"tel"}/>
      <button type="button" className="btn btn-sm btn-outline" disabled={testing||!contact.trim()} onClick={testAlert}>{testing?"Sending…":"Send a test"}</button>
     </div></label>
    {contactError&&<div className="mt-2"><Notice tone="error" role="alert">{contactError}</Notice></div>}
    {testNote&&<div className="mt-2"><Notice tone={testNote.tone} role={testNote.tone==="error"?"alert":undefined}>{testNote.text}</Notice></div>}
    <p className="text-xs text-base-content/45 mt-2">Only {alertStatus?.minimumSeverity??"high"} severity and above is worth a message, capped at {alertStatus?.maxPerHour??10} an hour. Messages from sample footage are marked simulated.</p>
   </div>}
  </>}
</fieldset>
<button className="btn btn-primary mt-5" disabled={saving||!duration} onClick={save}>{saving?"Saving…":"Save recording"}</button></div>}{error&&<div className="mt-5"><Notice tone="error" role="alert">{error}</Notice></div>}</Panel>
<Panel title="How this works"><div className="space-y-5 text-sm text-base-content/65"><p>Video files are stored in this browser using IndexedDB. Only sampled frames (4 every 8 seconds) are sent to the analysis server when you run AI analysis.</p><p>{model?.configured?`AI analysis uses ${model.model} via ${model.provider}. Its findings are suspected incidents until a person reviews them.`:"No analysis model is configured, so uploads start with no detections."}</p><div className="alert alert-info alert-soft"><Info size={18}/><span>{model?.configured?"Analysis starts after you click Save recording. The preview here is not analysed.":"To explore incident timelines and analytics, open the clearly labeled sample recordings in the video library."}</span></div></div></Panel></div></>}
