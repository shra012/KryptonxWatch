"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Cctv, Clapperboard, CloudUpload, Cpu, LayoutDashboard, ListFilter, Moon, Settings2, ShieldCheck, Sun, X } from "lucide-react";
import { useApp } from "./app-provider";
import { useTelemetry } from "./use-telemetry";
import { useModelStatus } from "@/lib/detection-client";

const groups=[
 {group:"Monitor",items:[{href:"/",label:"Overview",icon:LayoutDashboard},{href:"/live",label:"Live monitor",icon:Cctv},{href:"/detections",label:"Detection log",icon:ListFilter},{href:"/analytics",label:"Analytics",icon:BarChart3}]},
 {group:"Footage",items:[{href:"/upload",label:"Upload video",icon:CloudUpload},{href:"/videos",label:"Video library",icon:Clapperboard}]},
 {group:"Edge",items:[{href:"/system",label:"Edge node",icon:Cpu},{href:"/settings",label:"Preferences",icon:Settings2}]},
];
const nav=groups.flatMap(g=>g.items);
function active(path:string,href:string){return path===href||(href!=="/"&&path.startsWith(href+"/"));}

/** Whether a model is answering, and which one. */
function ModelChip(){
 const model=useModelStatus();
 if(!model) return null;
 return <Link href="/settings" title={model.configured?model.model:"No model configured"} className="hidden sm:flex items-center gap-2 border-l border-base-300 pl-3 font-mono text-[.62rem] uppercase tracking-[.06em]">
  <span className={`size-1.5 rounded-full ${model.configured?"bg-base-content":"bg-base-content/25"}`}/>
  <span className={model.configured?"text-base-content/70":"text-base-content/40"}>{model.configured?model.provider??"model":"demo"}</span>
 </Link>;
}

/** Header chip: one glance at whether the ZGX node is answering, and how busy it is. */
function EdgeChip(){
 const {snapshot,error,loading}=useTelemetry(10000);
 const gpu=snapshot?.gpu?.utilisation??null;
 const tone=error?"text-error":gpu==null?"text-base-content/50":gpu>=85?"text-warning":"text-base-content";
 const detail=error?"offline":gpu==null?"no GPU":`${Math.round(gpu)}%`;
 return <Link href="/system" className="flex items-center gap-2 border border-base-300 rounded-full px-3 py-1.5 bg-base-100 hover:bg-base-200 transition-colors" aria-label={`Edge node status: ${error?"unreachable":loading?"connecting":detail}`}>
  <span className={`relative flex size-1.5 ${tone}`}>{!error&&!loading&&<span className="absolute inline-flex size-full rounded-full bg-current opacity-60 animate-ping"/>}<span className="relative inline-flex size-1.5 rounded-full bg-current"/></span>
  <span className="font-mono text-[.62rem] uppercase tracking-[.06em] hidden sm:inline text-base-content/70">Edge</span>
  <span className={`font-mono text-[.62rem] tabular-nums ${tone}`}>{loading?"…":detail}</span>
 </Link>;
}

export function Shell({children}:{children:React.ReactNode}){const path=usePathname();const {theme,setTheme,toast,error,clearError}=useApp();
return <div className="min-h-screen lg:flex">
 <aside className="hidden lg:flex lg:w-66 lg:shrink-0 lg:flex-col bg-base-200 border-r border-base-300 px-4 py-6">
  <Link href="/" className="flex items-center gap-3 px-2 mb-8"><span className="grid place-items-center size-9 rounded-xl bg-linear-to-b from-primary to-primary/80 text-primary-content shadow-sm"><ShieldCheck size={18}/></span><span><span className="block text-[.95rem] font-semibold tracking-tight leading-5">Sentinel Machines</span><span className="block text-xs text-base-content/45">Edge vision</span></span></Link>
  <nav className="flex flex-col gap-6" aria-label="Main navigation">{groups.map(({group,items})=><div key={group}>
   <div className="text-[.7rem] font-medium text-base-content/40 px-3 mb-1.5">{group}</div>
   <div className="flex flex-col gap-0.5">{items.map(({href,label,icon:Icon})=><Link key={href} href={href} aria-current={active(path,href)?"page":undefined} className={`group flex gap-2.5 items-center rounded-lg px-3 py-2 text-sm font-medium transition-all ${active(path,href)?"bg-base-100 text-base-content shadow-[0_1px_2px_rgb(0_0_0/.06),0_0_0_1px_var(--color-base-300)]":"text-base-content/60 hover:text-base-content hover:bg-base-300/40"}`}><Icon size={16} className={active(path,href)?"":"opacity-80"}/>{label}</Link>)}</div>
  </div>)}</nav>
  <div className="mt-auto rounded-xl border border-base-300 bg-base-100 p-3.5"><div className="flex items-center gap-2 text-xs font-medium"><Activity size={13} className="text-primary"/>Local demo workspace</div><p className="text-xs text-base-content/50 mt-1.5 leading-relaxed">Sample annotations are simulated. Uploads stay in this browser and get no automated analysis.</p></div>
 </aside>
 <div className="min-w-0 flex-1">
  <header className="sticky top-0 z-30 bg-base-100/85 backdrop-blur border-b border-base-300 px-4 lg:px-8 h-16 flex items-center justify-between gap-3">
   <div className="lg:hidden"><Link href="/" className="font-semibold flex items-center gap-2"><ShieldCheck size={18}/>Sentinel Machines</Link></div>
   <div className="hidden lg:flex items-center gap-3 text-sm font-medium text-base-content/70">{nav.find(n=>active(path,n.href))?.label??"Workspace"}<ModelChip/></div>
   <div className="flex items-center gap-2"><EdgeChip/><button className="btn btn-ghost btn-circle btn-sm" aria-label={theme==="light"?"Switch to dark mode":"Switch to light mode"} onClick={()=>setTheme(theme==="light"?"dark":"light")}>{theme==="light"?<Moon size={17}/>:<Sun size={17}/>}</button><span className="avatar avatar-placeholder"><span className="bg-linear-to-br from-base-300 to-base-200 border border-base-300 rounded-full w-8 text-[.65rem] font-semibold">KW</span></span></div>

  </header>
  <nav className="lg:hidden bg-base-100/85 backdrop-blur border-b border-base-300 px-3 py-2 flex gap-1 overflow-x-auto scroll-quiet" aria-label="Mobile navigation">{nav.map(({href,label,icon:Icon})=><Link key={href} href={href} aria-current={active(path,href)?"page":undefined} className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${active(path,href)?"bg-primary text-primary-content":"text-base-content/60 hover:bg-base-200"}`}><Icon size={14}/>{label}</Link>)}</nav>
  {error&&<div className="mx-4 lg:mx-8 mt-5 flex items-start gap-3 border-l-2 border-error pl-3.5 py-1.5" role="alert"><span className="text-sm text-base-content/80 flex-1">{error}</span><button className="btn btn-ghost btn-xs btn-circle" onClick={clearError} aria-label="Dismiss error"><X size={14}/></button></div>}
  <main className="fade-in p-4 lg:p-8 max-w-[1500px] mx-auto" key={path}>{children}</main>
 </div>
 {toast&&<div role="status" className="toast toast-end z-50"><div className="fade-in bg-neutral text-neutral-content rounded-xl px-4 py-2.5 text-sm shadow-xl ring-1 ring-white/10">{toast}</div></div>}
 </div>}
