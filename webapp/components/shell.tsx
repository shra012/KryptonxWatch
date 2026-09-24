"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Clapperboard, CloudUpload, LayoutDashboard, ListFilter, Moon, Settings2, ShieldCheck, Sun, X, Cctv } from "lucide-react";
import { useApp } from "./app-provider";
import { useModelStatus } from "@/lib/detection-client";
function ModelBadge(){const model=useModelStatus();if(!model)return null;return model.configured?<Link href="/settings" className="badge badge-primary badge-soft hidden sm:inline-flex" title={model.model}>AI connected · {model.provider}</Link>:<span className="badge badge-info badge-soft hidden sm:inline-flex">Demo mode</span>}
const nav=[{href:"/",label:"Overview",icon:LayoutDashboard},{href:"/upload",label:"Upload video",icon:CloudUpload},{href:"/live",label:"Live monitor",icon:Cctv},{href:"/videos",label:"Video library",icon:Clapperboard},{href:"/detections",label:"Detection log",icon:ListFilter},{href:"/analytics",label:"Analytics",icon:BarChart3},{href:"/settings",label:"Preferences",icon:Settings2}];
export function Shell({children}:{children:React.ReactNode}){const path=usePathname();const {theme,setTheme,toast,error,clearError}=useApp();
return <div className="min-h-screen lg:flex">
 <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col bg-base-100 border-r border-base-300 px-4 py-6">
  <Link href="/" className="flex items-center gap-3 px-3 mb-9 text-xl font-bold tracking-tight text-primary"><span className="rounded-xl bg-primary text-primary-content p-2"><ShieldCheck size={23}/></span>KryptonxWatch</Link>
  <div className="text-xs uppercase tracking-widest text-base-content/45 px-3 mb-3">Workspace</div>
  <nav className="flex flex-col gap-1" aria-label="Main navigation">{nav.map(({href,label,icon:Icon})=><Link key={href} href={href} className={`flex gap-3 items-center rounded-xl px-3 py-3 text-sm font-medium ${path===href || (href!=="/"&&path.startsWith(href+"/"))?"bg-primary/10 text-primary":"text-base-content/65 hover:bg-base-200 hover:text-base-content"}`}><Icon size={18}/>{label}</Link>)}</nav>
  <div className="mt-auto rounded-2xl bg-primary/5 border border-primary/10 p-4 text-sm"><div className="font-semibold">Local demo workspace</div><p className="text-base-content/60 mt-1">Sample annotations are simulated. Your uploads stay in this browser.</p></div>
 </aside>
 <div className="min-w-0 flex-1">
  <header className="sticky top-0 z-30 bg-base-100/90 backdrop-blur border-b border-base-300 px-4 lg:px-8 h-18 flex items-center justify-between gap-3">
   <div className="lg:hidden"><Link href="/" className="font-bold text-primary flex items-center gap-2"><ShieldCheck size={21}/>KryptonxWatch</Link></div>
   <div className="hidden lg:block text-sm text-base-content/55">Recorded video review workspace</div>
   <div className="flex items-center gap-2"><ModelBadge/><button className="btn btn-ghost btn-circle" aria-label={theme==="light"?"Switch to dark mode":"Switch to light mode"} onClick={()=>setTheme(theme==="light"?"dark":"light")}>{theme==="light"?<Moon size={20}/>:<Sun size={20}/>}</button><span className="avatar avatar-placeholder"><span className="bg-primary/10 text-primary rounded-full w-9 text-xs font-bold">KW</span></span></div>
  </header>
  <nav className="lg:hidden bg-base-100 border-b border-base-300 px-3 py-2 flex gap-1 overflow-x-auto" aria-label="Mobile navigation">{nav.map(({href,label,icon:Icon})=><Link key={href} href={href} className={`btn btn-sm shrink-0 ${path===href?"btn-primary":"btn-ghost"}`}><Icon size={15}/>{label}</Link>)}</nav>
  {error&&<div className="mx-4 lg:mx-8 mt-5 alert alert-error"><span>{error}</span><button className="btn btn-sm btn-ghost" onClick={clearError} aria-label="Dismiss error"><X size={16}/></button></div>}
  <main className="p-4 lg:p-8 max-w-[1500px] mx-auto">{children}</main>
 </div>
 {toast&&<div role="status" className="toast toast-end z-50"><div className="alert alert-info shadow-lg"><span>{toast}</span></div></div>}
 </div>}
