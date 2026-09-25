"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Cctv, Eye, Film, Hand, Moon, ScanSearch, ShieldCheck, Sparkles, Sun, UserRoundX, Warehouse } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { MonitorTile } from "@/components/monitor-tile";
import { SeverityBadge } from "@/components/ui";
import { defaultSeverity, detectableCategories } from "@/lib/vlm/analysis";
import { uniqueFootage } from "@/lib/analytics";
import { sameFootage, useFingerprints } from "@/lib/fingerprint";
import { isSecurityDetection, timecode, type Detection, type VideoRecord } from "@/lib/types";

/** Fades a section in the first time it scrolls into view. */
function Reveal({children,className="",delay=0}:{children:React.ReactNode;className?:string;delay?:number}){
 const ref=useRef<HTMLDivElement>(null); const [seen,setSeen]=useState(false);
 useEffect(()=>{const el=ref.current;if(!el)return;const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){setSeen(true);io.disconnect();}},{threshold:.15});io.observe(el);return()=>io.disconnect();},[]);
 return <div ref={ref} className={`landing-reveal ${seen?"is-in":""} ${className}`} style={{transitionDelay:`${delay}ms`}}>{children}</div>;
}

/** A figure that counts up from zero when it comes into view. */
function CountUp({to,decimals=0,suffix=""}:{to:number;decimals?:number;suffix?:string}){
 const ref=useRef<HTMLSpanElement>(null); const [v,setV]=useState(0);
 useEffect(()=>{const el=ref.current;if(!el)return;let raf=0;
  const io=new IntersectionObserver(([e])=>{if(!e.isIntersecting)return;io.disconnect();
   if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){setV(to);return;}
   const t0=performance.now();const step=(t:number)=>{const f=Math.min(1,(t-t0)/1200);setV(to*(1-Math.pow(1-f,3)));if(f<1)raf=requestAnimationFrame(step);};raf=requestAnimationFrame(step);},{threshold:.4});
  io.observe(el);return()=>{io.disconnect();cancelAnimationFrame(raf);};},[to]);
 return <span ref={ref}>{v.toFixed(decimals)}{suffix}</span>;
}

/** A demo clip playing as a plain camera feed, before any analysis has run on it. */
function FeedTile({file,title,index}:{file:string;title:string;index:number}){
 const kind=title.replace(/[\d_]+.*$/,"")||"Camera"; // "Fighting1" -> "Fighting": the landing page names the type only
 return <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black">
  <video src={`/api/demo-clips/${encodeURIComponent(file)}`} autoPlay muted loop playsInline preload="metadata" className="absolute inset-0 size-full object-cover opacity-80"/>
  <span className="absolute top-2 left-2.5 flex items-center gap-1.5 font-mono text-[.58rem] tracking-widest text-white/70"><span className="size-1.5 rounded-full bg-white/80 motion-safe:animate-pulse"/>CH{String(index+1).padStart(2,"0")}</span>
  <span className="absolute bottom-2 left-2.5 font-mono text-[.6rem] text-white/60">{kind} · watching</span>
 </div>;
}

type Flagged = { video: VideoRecord; detection: Detection };
const rank=(d:Detection)=>d.severity==="critical"?3:d.severity==="high"?2:d.severity==="medium"?1:0;

/** Up to `n` tiles, one per crime type first (most serious of each), then the rest by severity. */
function varied(flagged:Flagged[],n=4){
 const out:Flagged[]=[];const types=new Set<string>();
 for(const f of flagged)if(out.length<n&&!types.has(f.detection.category)){out.push(f);types.add(f.detection.category);}
 for(const f of flagged)if(out.length<n&&!out.includes(f))out.push(f);
 return out;
}

/** The hero's console: this browser's flagged recordings looping with boxes, else the server's demo clips, else empty channels. */
function Wall({flagged,clips}:{flagged:Flagged[];clips:{file:string;title:string}[]}){
 const ref=useRef<HTMLDivElement>(null);
 const [line,setLine]=useState(0);
 const lines=flagged.length?flagged.map((f,i)=>`CH${String(i+1).padStart(2,"0")} · ${f.detection.category.toLowerCase()} · ${timecode(f.detection.seconds)}${f.detection.confidence!=null?` · ${Math.round(f.detection.confidence*100)}%`:""}`)
  :["CH01 · window 00:00–00:08 · no incident","CH02 · window 00:08–00:16 · no incident","CH03 · window 00:16–00:24 · reviewing"];
 useEffect(()=>{const id=setInterval(()=>setLine(l=>l+1),2600);return()=>clearInterval(id);},[]);
 const move=(e:React.MouseEvent)=>{const r=ref.current!.getBoundingClientRect();ref.current!.style.setProperty("--mx",`${e.clientX-r.left}px`);ref.current!.style.setProperty("--my",`${e.clientY-r.top}px`);};
 const tiles=varied(flagged);
 return <div ref={ref} onMouseMove={move} className="relative rounded-2xl border border-base-300 bg-neutral p-3 shadow-2xl shadow-black/20 overflow-hidden">
  <div className="flex items-center justify-between px-1 pb-3 font-mono text-[.62rem] uppercase tracking-[.08em] text-neutral-content/55">
   <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-neutral-content/80 motion-safe:animate-pulse"/>Monitor wall</span>
   <span>{flagged.length?`${flagged.length} flagged`:clips.length?`${Math.min(4,clips.length)} feeds`:"standby"}</span>
  </div>
  <div className="grid grid-cols-2 gap-2">
   {tiles.length?tiles.map((f,i)=><MonitorTile key={f.video.id} video={f.video} detection={f.detection} index={i} caption="category"/>)
    :clips.length?clips.slice(0,4).map((c,i)=><FeedTile key={c.file} file={c.file} title={c.title} index={i}/>)
    :[0,1,2,3].map(i=><div key={i} className="aspect-video rounded-lg border border-white/10 bg-black/60 grid place-items-center font-mono text-[.6rem] text-white/35">CH{String(i+1).padStart(2,"0")} · no signal</div>)}
  </div>
  <div className="mt-3 flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2 font-mono text-[.66rem] text-neutral-content/75 overflow-hidden">
   <ScanSearch size={13} className="shrink-0 opacity-70"/><span key={line} className="landing-ticker truncate">{lines[line%lines.length]}</span>
  </div>
  <div className="landing-scan"/><div className="landing-spot absolute inset-0"/>
 </div>;
}

const steps=[
 {icon:Cctv,title:"Watch",text:"Any camera: a recorded upload, a replayed feed or a live webcam. Many streams at once, each on its own clock.",spec:"MP4 · WebM · webcam"},
 {icon:Film,title:"Sample",text:"Four frames every eight seconds, one every two, at most 512 px wide. Short answers per window keep a big, bandwidth-bound box busy on many cameras.",spec:"4 frames / 8 s window"},
 {icon:Eye,title:"Understand",text:"A vision-language model reads the frames together and answers in JSON: what happened, which crime, how sure it is and where.",spec:"Qwen3-VL-30B on the GB10 · any OpenAI-compatible model"},
 {icon:ScanSearch,title:"Locate",text:"A person detector finds everyone in frame. The box snaps to the person the model means and follows them through the window.",spec:"YOLO11 · per-frame tracking"},
 {icon:Hand,title:"Review",text:"It lands in the review queue as suspected, never accused. The owner can be texted, messaged on WhatsApp or emailed; a person decides.",spec:"Human review · opt-in alerts"},
];

/** The pipeline as a stepper that advances by itself and pauses while you point at it. */
function Pipeline(){
 const [active,setActive]=useState(0); const [paused,setPaused]=useState(false);
 useEffect(()=>{if(paused)return;const id=setTimeout(()=>setActive(a=>(a+1)%steps.length),3500);return()=>clearTimeout(id);},[active,paused]);
 const s=steps[active];
 return <div onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={()=>setPaused(false)} className="grid lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] gap-8 items-start">
  <ol className="space-y-1" aria-label="How it works">{steps.map((st,i)=><li key={st.title}>
   <button onClick={()=>setActive(i)} aria-current={i===active?"step":undefined} className={`w-full text-left rounded-lg px-4 py-3 transition-colors ${i===active?"bg-base-200":"hover:bg-base-200/60"}`}>
    <div className="flex items-center gap-3"><span className="font-mono text-xs text-base-content/40 w-5">{String(i+1).padStart(2,"0")}</span><st.icon size={17} className={i===active?"":"opacity-50"}/><span className={`font-medium ${i===active?"":"text-base-content/60"}`}>{st.title}</span></div>
    <div className="mt-2 ml-8 h-px bg-base-300 overflow-hidden">{i===active&&<div key={`${active}-${paused}`} className={`h-px bg-base-content origin-left ${paused?"":"landing-pulse"}`} style={paused?{transform:"scaleX(1)"}:undefined}/>}</div>
   </button></li>)}</ol>
  <div key={active} className="fade-in rounded-xl border border-base-300 p-6 lg:p-8">
   <div className="flex items-center gap-3"><span className="grid place-items-center size-10 rounded-lg bg-base-200"><s.icon size={19}/></span><span className="font-mono text-[.66rem] uppercase tracking-[.08em] text-base-content/50">Step {active+1} of {steps.length}</span></div>
   <h3 className="text-2xl font-semibold tracking-tight mt-5">{s.title}</h3>
   <p className="text-base-content/65 mt-3 leading-relaxed">{s.text}</p>
   <p className="font-mono text-xs text-base-content/50 mt-6 border-t border-base-300 pt-4">{s.spec}</p>
   {/* The whole path at a glance: a dot per step, filled up to the current one. */}
   <div className="flex items-center gap-2 mt-6" aria-hidden>{steps.map((_,i)=><span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${i<=active?"bg-base-content":"bg-base-300"}`}/>)}</div>
  </div>
 </div>;
}

const descriptions:Record<(typeof detectableCategories)[number],string>={
 Shoplifting:"Concealing merchandise, or leaving a store with unpaid goods.",Theft:"Taking property that is not theirs outside a shop: bags, bikes, packages, parked cars.",
 Robbery:"Taking property by force or threat, at a counter or on the street.",Pickpocketing:"Stealing from a pocket or bag by close contact.",
 Fighting:"Physical assault: punching, kicking, shoving, wrestling.",Vandalism:"Deliberately damaging or defacing property.",Gun:"A firearm is visible.",
 "Medical emergency":"A collapse, fall, seizure or someone lying motionless.","Kiosk nonpayment":"Bypassing payment at a self-checkout.",
 "Suspicious activity":"Concerning behaviour that fits none of the above.",
};

function Categories(){
 const [pick,setPick]=useState<(typeof detectableCategories)[number]>("Robbery");
 return <div>
  <div className="flex flex-wrap gap-2">{detectableCategories.map(c=><button key={c} onMouseEnter={()=>setPick(c)} onFocus={()=>setPick(c)} onClick={()=>setPick(c)} aria-pressed={pick===c}
   className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${pick===c?"border-base-content bg-base-content text-base-100":"border-base-300 hover:border-base-content/40"}`}>{c}</button>)}</div>
  <div key={pick} className="fade-in mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-l-2 border-base-content pl-4 py-1">
   <span className="font-medium">{pick}</span><SeverityBadge severity={defaultSeverity[pick]}/><span className="text-base-content/65">{descriptions[pick]}</span>
  </div>
 </div>;
}

export default function Landing(){
 const {videos,theme,setTheme}=useApp();
 const [clips,setClips]=useState<{file:string;title:string}[]>([]);
 useEffect(()=>{fetch("/api/demo-clips").then(r=>r.json()).then(d=>setClips(d.available?d.clips:[])).catch(()=>{});},[]);
 const prints=useFingerprints(videos);
 const flagged:Flagged[]=uniqueFootage(videos,(a,b)=>sameFootage(prints[a.id],prints[b.id])).flatMap(v=>{const top=v.detections.filter(d=>isSecurityDetection(d)&&rank(d)>0).sort((a,b)=>rank(b)-rank(a))[0];return top?[{video:v,detection:top}]:[]}).sort((a,b)=>rank(b.detection)-rank(a.detection));

 return <div className="min-h-screen bg-base-100 text-base-content">
  <header className="sticky top-0 z-40 bg-base-100/80 backdrop-blur border-b border-base-300/70">
   <div className="max-w-6xl mx-auto px-4 lg:px-8 h-16 flex items-center justify-between gap-4">
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight"><span className="grid place-items-center size-8 rounded-lg bg-primary text-primary-content"><ShieldCheck size={16}/></span>Sentinel Machines</Link>
    <nav className="hidden md:flex items-center gap-7 text-sm text-base-content/60" aria-label="Sections"><a href="#how" className="hover:text-base-content">How it works</a><a href="#detects" className="hover:text-base-content">What it detects</a><a href="#principles" className="hover:text-base-content">Principles</a></nav>
    <div className="flex items-center gap-2">
     <button className="btn btn-ghost btn-circle btn-sm" aria-label={theme==="light"?"Switch to dark mode":"Switch to light mode"} onClick={()=>setTheme(theme==="light"?"dark":"light")}>{theme==="light"?<Moon size={16}/>:<Sun size={16}/>}</button>
     <Link href="/overview" className="btn btn-primary btn-sm">Open console<ArrowRight size={15}/></Link>
    </div>
   </div>
  </header>

  <section className="relative overflow-hidden">
   <div className="landing-grid absolute inset-0" aria-hidden/>
   <div className="relative max-w-6xl mx-auto px-4 lg:px-8 pt-16 lg:pt-24 pb-20 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-12 items-center">
    <div className="fade-in">
     <p className="font-mono text-[.68rem] uppercase tracking-[.08em] text-base-content/55 flex items-center gap-2"><Sparkles size={13}/>Edge vision · runs on the HP ZGX Nano</p>
     <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight mt-5 leading-[1.02]">Sentinel<br/>Machines</h1>
     <p className="text-xl sm:text-2xl tracking-tight mt-6 text-base-content/80">Your cameras already see theft. Nobody is watching them. Now something is.</p>
     <p className="text-base-content/60 mt-5 leading-relaxed max-w-xl">A vision-language model on an on-site GB10 reviews every camera in eight-second windows, names the crime, boxes the person and puts it in front of a human within seconds.</p>
     <div className="flex flex-wrap gap-3 mt-8">
      <Link href="/overview" className="btn btn-primary">Open the console<ArrowRight size={16}/></Link>
      <Link href="/live" className="btn btn-outline"><Cctv size={16}/>Watch a live feed</Link>
     </div>
     <p className="text-xs text-base-content/45 mt-5">Detections are suspected until a person reviews them.</p>
    </div>
    <div className="fade-in" style={{animationDelay:"120ms"}}><Wall flagged={flagged} clips={clips}/></div>
   </div>
  </section>

  <section className="border-y border-base-300 bg-base-200/50">
   <div className="max-w-6xl mx-auto px-4 lg:px-8 grid grid-cols-2 lg:grid-cols-4 divide-x divide-base-300">
    {[{v:<CountUp to={8} suffix=" s"/>,l:"Every camera gets a fresh look every eight seconds"},
      {v:<CountUp to={2.1} decimals={1} suffix=" s"/>,l:"Median answer per window, Qwen3-VL on the GB10"},
      {v:<CountUp to={94} suffix="%"/>,l:"Of 35 crime clips flagged in a fresh 65-clip test, Qwen3-VL"},
      {v:<CountUp to={128} suffix=" GB"/>,l:"Unified memory: models, detector and app on one box"}].map((f,i)=>
     <Reveal key={i} delay={i*80} className="px-5 py-8 first:pl-0 [&:nth-child(3)]:pl-0 lg:[&:nth-child(3)]:pl-5"><div className="font-mono text-3xl sm:text-4xl tabular-nums tracking-tight">{f.v}</div><p className="text-sm text-base-content/55 mt-2 leading-snug">{f.l}</p></Reveal>)}
   </div>
  </section>

  <section id="how" className="max-w-6xl mx-auto px-4 lg:px-8 py-24 scroll-mt-16">
   <Reveal><p className="font-mono text-[.68rem] uppercase tracking-[.08em] text-base-content/50">How it works</p><h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3 max-w-2xl">From a camera frame to a person deciding, in five steps.</h2></Reveal>
   <Reveal delay={100} className="mt-12"><Pipeline/></Reveal>
  </section>

  <section id="detects" className="border-t border-base-300">
   <div className="max-w-6xl mx-auto px-4 lg:px-8 py-24 scroll-mt-16">
    <Reveal><p className="font-mono text-[.68rem] uppercase tracking-[.08em] text-base-content/50">What it detects</p><h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3 max-w-2xl">Ten kinds of incident, named, not just flagged.</h2>
     <p className="text-base-content/60 mt-4 max-w-2xl">Point at one to see what the model looks for. Queue length is measured too, as a count rather than an incident.</p></Reveal>
    <Reveal delay={100} className="mt-10"><Categories/></Reveal>
   </div>
  </section>

  <section id="principles" className="border-t border-base-300 bg-base-200/50">
   <div className="max-w-6xl mx-auto px-4 lg:px-8 py-24 scroll-mt-16">
    <Reveal><p className="font-mono text-[.68rem] uppercase tracking-[.08em] text-base-content/50">Principles</p><h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3">Built to watch, not to judge.</h2></Reveal>
    <div className="grid md:grid-cols-3 gap-8 mt-12">
     {[{icon:UserRoundX,t:"No face recognition",d:"No identity database and no watchlist. It describes what people do, never who they are."},
       {icon:Hand,t:"A person decides",d:"Every detection is suspected until someone reviews it. The system never accuses anyone, and alerts are opt-in and capped."},
       {icon:Warehouse,t:"Footage stays on site",d:"With the local model, frames go only to the GB10 in the building. Cloud models are there for comparison, and only when you pick one."}].map((p,i)=>
      <Reveal key={p.t} delay={i*100} className="border-t border-base-content/80 pt-5"><p.icon size={20}/><h3 className="font-semibold mt-4">{p.t}</h3><p className="text-sm text-base-content/60 mt-2 leading-relaxed">{p.d}</p></Reveal>)}
    </div>
   </div>
  </section>

  <section className="max-w-6xl mx-auto px-4 lg:px-8 py-24 text-center">
   <Reveal><h2 className="text-3xl sm:text-5xl font-semibold tracking-tight">See it on your own footage.</h2>
    <p className="text-base-content/60 mt-4">Upload a recording, or load the demo clips from the video library.</p>
    <div className="flex flex-wrap justify-center gap-3 mt-8"><Link href="/upload" className="btn btn-primary">Upload a video<ArrowRight size={16}/></Link><Link href="/videos" className="btn btn-outline">Video library</Link></div></Reveal>
  </section>

  <footer className="border-t border-base-300">
   <div className="max-w-6xl mx-auto px-4 lg:px-8 py-8 flex flex-wrap items-center justify-between gap-3 text-xs text-base-content/50">
    <span className="flex items-center gap-2 font-medium text-base-content/70"><ShieldCheck size={14}/>Sentinel Machines</span>
    <span>Edge AI SJSUHack 2026 · HP ZGX Nano (NVIDIA GB10) · demo footage from UCF-Crime, research use</span>
   </div>
  </footer>
 </div>;
}
