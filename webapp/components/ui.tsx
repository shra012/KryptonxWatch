import type { Detection, Severity } from "@/lib/types";
import { dateLabel, timecode } from "@/lib/types";
export function PageTitle({eyebrow,title,description,action,hero=false}:{eyebrow?:string;title:string;description:string;action?:React.ReactNode;hero?:boolean}){
 if(hero) return <header className="mb-8">
  {eyebrow&&<div className="font-mono text-xs uppercase tracking-[.08em] text-primary mb-3">{eyebrow}</div>}
  <h1 className="text-4xl lg:text-[3.1rem] font-bold tracking-[-.03em] leading-[1.02]">{title}</h1>
  <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 mt-4">
   <p className="text-base text-base-content/60 max-w-xl leading-relaxed">{description}</p>{action}
  </div>
 </header>;
 return <header className="mb-8 border-b border-base-300 pb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
  <div className="min-w-0">
   <div className="flex items-baseline gap-2.5 flex-wrap">{eyebrow&&<><span className="font-mono text-[.66rem] uppercase tracking-[.08em] text-primary">{eyebrow}</span><span className="text-base-content/25">/</span></>}<h1 className="text-2xl lg:text-[1.75rem] font-semibold tracking-[-.025em]">{title}</h1></div>
   <p className="text-sm text-base-content/55 mt-1.5 max-w-2xl">{description}</p>
  </div>{action}
 </header>;
}

export function Panel({title,children,action,className=""}:{title?:string;children:React.ReactNode;action?:React.ReactNode;className?:string}){
 return <section className={`min-w-0 ${className}`}>{(title||action)&&<div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4"><h2 className="font-mono text-[.7rem] uppercase tracking-[.06em] text-base-content/50 shrink-0">{title}</h2><span className="h-px flex-1 min-w-8 bg-base-300"/><div className="shrink-0 max-w-full">{action}</div></div>}{children}</section>;
}

/* Severity and review state are typographic, not coloured pills: a swatch from the
   achromatic ramp plus the word itself. Nothing in the interface is ranked by hue. */
const sevRamp: Record<Severity,string> = { critical:"var(--sev-critical)", high:"var(--sev-high)", medium:"var(--sev-medium)", low:"var(--sev-low)", measurement:"var(--sev-metric)" };
export function SeverityBadge({severity}:{severity:Severity}){
 const label = severity==="measurement" ? "Queue metric" : severity;
 return <span className="inline-flex items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-2 py-0.5 text-[.7rem] font-medium capitalize text-base-content/75 whitespace-nowrap">
  <span className="size-1.5 rounded-full shrink-0" style={{background:sevRamp[severity]}} aria-hidden/>{label}
 </span>;
}
export function StatusBadge({status}:{status:Detection["status"]}){
 return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[.7rem] font-medium capitalize whitespace-nowrap ${status==="new"?"bg-base-content text-base-100":status==="reviewed"?"bg-base-200 text-base-content/75 ring-1 ring-inset ring-base-300":"text-base-content/45 ring-1 ring-inset ring-base-300"}`}>{status}</span>;
}
export function EventLabel({d}:{d:Detection}){return <span>{d.severity==="measurement"?d.category:`Suspected ${d.category.toLowerCase()}`}</span>}
export function EmptyState({title,description,action}:{title:string;description:string;action?:React.ReactNode}){
 return <div className="rounded-xl border border-dashed border-base-300 px-5 py-8 text-center"><div className="font-medium">{title}</div><p className="text-sm text-base-content/55 mt-1 max-w-lg mx-auto">{description}</p>{action&&<div className="mt-4">{action}</div>}</div>;
}
/** A line of consequence. A rule in the margin, not a tinted box with an icon in it. */
export function Notice({tone="muted",children,role}:{tone?:"muted"|"info"|"warning"|"error";children:React.ReactNode;role?:string}){
 const rule={muted:"border-base-300",info:"border-primary",warning:"border-warning",error:"border-error"}[tone];
 return <p role={role} className={`border-l-2 ${rule} pl-3.5 py-1 text-sm text-base-content/70`}>{children}</p>;
}

export function EventTime({seconds}:{seconds:number}){return <span className="font-mono tabular-nums">{timecode(seconds)}</span>}
export function RecordedDate({value}:{value:string}){return <span>{dateLabel(value)}</span>}

/* Instrument primitives. These are plain SVG rather than Recharts: they render at
   40-120px and are redrawn every few seconds, so a chart library is overkill.
   Colour always comes from a daisyUI token via `currentColor`. */
export function Gauge({value,label,unit="%",max=100,tone="text-primary",size=132}:{value:number|null;label:string;unit?:string;max?:number;tone?:string;size?:number}){
 const r=size/2-11, c=2*Math.PI*r, span=.74, frac=value==null?0:Math.min(1,Math.max(0,value/max));
 // Tall enough for the arc's rounded ends, which dip below the centre, so the label never sits on them.
 const height=Math.ceil(size/2+r*Math.cos((1-span)*Math.PI)+6);
 return <div className="flex flex-col items-center gap-2 min-w-0" role="img" aria-label={`${label}: ${value==null?"unavailable":`${Math.round(value)}${unit}`}`}>
  <svg viewBox={`0 0 ${size} ${height}`} className="w-full h-auto" style={{maxWidth:size}}>
   <g transform={`translate(${size/2} ${size/2}) rotate(${90+(1-span)*180})`}>
    <circle r={r} fill="none" strokeWidth="9" strokeLinecap="round" className="text-base-300" stroke="currentColor" strokeDasharray={`${c*span} ${c}`}/>
    <circle r={r} fill="none" strokeWidth="9" strokeLinecap="round" className={value==null?"text-base-300":tone} stroke="currentColor" strokeDasharray={`${c*span*frac} ${c}`} style={{transition:"stroke-dasharray .6s ease"}}/>
   </g>
   <text x={size/2} y={size/2-2} textAnchor="middle" className="fill-base-content font-mono font-semibold" fontSize={size*.2}>{value==null?"—":Math.round(value)}</text>
   <text x={size/2} y={size/2+16} textAnchor="middle" className="fill-base-content/45" fontSize={size*.09}>{value==null?"unavailable":unit}</text>
  </svg>
  <div className="font-mono text-[.66rem] uppercase tracking-[.06em] text-base-content/55 text-center leading-tight">{label}</div>
 </div>;
}
export function Sparkline({values,tone="text-primary",height=38,label}:{values:(number|null)[];tone?:string;height?:number;label:string}){
 const real=values.filter((v):v is number=>v!=null);
 if(!real.length) return <div className="text-xs text-base-content/30 flex items-center" style={{height}}>no data</div>;
 if(real.length<2) return <div className="text-xs text-base-content/40 flex items-center" style={{height}}>collecting…</div>;
 const lo=Math.min(...real), hi=Math.max(...real), span=hi-lo||1, w=100;
 const pts=values.map((v,i)=>v==null?null:`${(i/(values.length-1))*w},${height-((v-lo)/span)*(height-4)-2}`).filter(Boolean).join(" ");
 return <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label={`${label} trend, latest ${Math.round(real[real.length-1])}`}>
  <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" className={tone}/>
 </svg>;
}
export function Meter({value,max=100,tone="bg-primary",label,caption}:{value:number|null;max?:number;tone?:string;label:string;caption?:string}){
 const frac=value==null?0:Math.min(100,Math.max(0,(value/max)*100));
 return <div><div className="flex items-baseline justify-between gap-3 mb-1.5"><span className="text-sm text-base-content/70">{label}</span><span className="font-mono text-sm tabular-nums">{caption??(value==null?"unavailable":`${Math.round(frac)}%`)}</span></div>
  <div className="h-2 rounded-full bg-base-300 overflow-hidden" role="meter" aria-valuenow={value==null?undefined:Math.round(frac)} aria-valuemin={0} aria-valuemax={100} aria-label={label}><div className={`h-full rounded-full ${value==null?"bg-base-300":tone}`} style={{width:`${frac}%`,transition:"width .6s ease"}}/></div></div>;
}
export function Readout({label,value,hint,tone="",className=""}:{label:string;value:React.ReactNode;hint?:string;tone?:string;className?:string}){
 return <div className={`border-r border-b border-base-300 px-4 py-3.5 min-w-0 ${className}`}><div className="font-mono text-[.62rem] uppercase tracking-[.06em] text-base-content/45">{label}</div><div className={`font-mono text-lg font-semibold tabular-nums mt-1.5 truncate ${tone}`}>{value}</div>{hint&&<div className="text-xs text-base-content/45 mt-0.5 truncate">{hint}</div>}</div>;
}
export function Unavailable({title,reason}:{title:string;reason:string}){
 return <div className="border-r border-b border-base-300 px-4 py-3.5"><div className="font-mono text-[.62rem] uppercase tracking-[.06em] text-base-content/45">{title}</div><div className="font-mono text-lg text-base-content/25 mt-1.5">not sampled</div><p className="text-xs text-base-content/45 mt-1">{reason}</p></div>;
}

/** A "?" that explains a reading. Keyboard reachable, so it is a button, not a title attribute. */
export function Hint({text}:{text:string}){
 return <span className="tooltip tooltip-bottom align-middle" data-tip={text}><button type="button" className="text-base-content/30 hover:text-base-content/60 align-middle cursor-help" aria-label={text}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.6"/><path d="M6.2 6.1a1.85 1.85 0 1 1 2.1 1.85v1.2" strokeLinecap="round"/><circle cx="8.3" cy="11.5" r=".75" fill="currentColor" stroke="none"/></svg></button></span>;
}

/** One cell of the device rail: what it is, what it reads, how full that is, and against what. */
export function DeviceMetric({label,help,value,unit,fraction,caption,tone="bg-primary"}:{label:string;help:string;value:number|string|null;unit?:string;fraction:number|null;caption:string;tone?:string}){
 const missing=value==null;
 return <div className="flex-1 min-w-[11.5rem] px-5 py-4 border-b sm:border-b-0 sm:border-r border-base-300 last:border-r-0 last:border-b-0">
  <div className="flex items-start justify-between gap-3">
   <span className="text-sm text-base-content/70 leading-tight max-w-[9.5rem]">{label} <Hint text={help}/></span>
   <span className={`font-mono text-2xl font-bold tabular-nums leading-none whitespace-nowrap ${missing?"text-base-content/25":""}`}>{missing?"—":value}{!missing&&unit&&<span className="text-base font-semibold"> {unit}</span>}</span>
  </div>
  <div className="h-[3px] rounded-full bg-base-300 mt-3.5 overflow-hidden"><div className={`h-full rounded-full ${fraction==null?"":tone}`} style={{width:`${Math.min(100,Math.max(0,(fraction??0)*100))}%`,transition:"width .6s ease"}}/></div>
  <p className="text-xs text-base-content/50 mt-2 leading-snug">{caption}</p>
 </div>;
}
