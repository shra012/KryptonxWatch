"use client";
import { Cpu, Gauge as GaugeIcon, HardDrive, MemoryStick, Thermometer, Zap } from "lucide-react";
import { useTelemetry } from "@/components/use-telemetry";
import { DeviceMetric, EmptyState, Gauge, Meter, Notice, PageTitle, Panel, Readout, Sparkline } from "@/components/ui";
import { gb, pct } from "@/lib/telemetry-types";

const one=(v:number|null,unit="")=>v==null?"—":`${v.toFixed(1)}${unit}`;
const whole=(v:number|null,unit="")=>v==null?"—":`${Math.round(v)}${unit}`;
function uptime(seconds:number|null){if(seconds==null)return "—";const d=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60);return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m`;}
function ago(iso:string|null){if(!iso)return null;const s=Math.max(0,Math.round((Date.now()-Date.parse(iso))/1000));return s<60?`${s}s ago`:s<3600?`${Math.floor(s/60)}m ago`:`${Math.floor(s/3600)}h ago`;}
function load(v:number|null){return v==null?"text-base-content":v>=90?"text-error":v>=70?"text-warning":"text-base-content";}

export default function SystemPage(){
 const {snapshot,history,error,loading}=useTelemetry(3000);
 const gpu=snapshot?.gpu??null, host=snapshot?.host, inference=snapshot?.inference;
 const memShare=pct(host?.memoryUsedMb??null,host?.memoryTotalMb??null);
 const vramShare=pct(gpu?.memoryUsedMb??null,gpu?.memoryTotalMb??null);
 const live=!error&&!loading;
 const powerFraction=gpu?.powerWatts!=null&&gpu.powerLimitWatts?gpu.powerWatts/gpu.powerLimitWatts:null;
 const memFraction=memShare==null?null:memShare/100;
 const tps=inference?.tokensPerSecond??null;
  const modelName=inference?.model, where=inference?.local?"local":"remote";
 const inferenceCaption=tps!=null?`${modelName} (${where}) · ${inference!.calls} ${inference!.calls===1?"call":"calls"} in the last ${inference!.windowSeconds}s.`:inference?.lastAt?`Idle · last call ${ago(inference.lastAt)} · ${modelName} (${where}).`:"Idle · no model calls since the server started.";
 const gpuMemHint=gpu?.memorySource==="processes";
 return <>
 <PageTitle hero eyebrow="Physical device" title="Device operations" description="Monitor ZGX Nano capacity, see what is holding the accelerator, and watch the node that every inference runs on — from one live view."
  action={<div className="flex items-center gap-2.5 rounded-full border border-base-300 bg-base-100 pl-3 pr-4 py-2 text-sm">
   <span className={`size-2 rounded-full ${error?"bg-error":live?"bg-base-content animate-pulse":"bg-base-content/30"}`}/>
   <span className="font-medium">{error?"Unreachable":live?"Live":"Connecting"}</span>
   {snapshot&&<span className="text-base-content/45 font-mono text-xs">{new Date(snapshot.at).toLocaleTimeString()}</span>}
  </div>}/>

 {/* The rail reads left to right from what the model does with the silicon to what
     the silicon costs. Inference speed needs a recent model call and says so rather
     than showing a zero. GB10 does not expose tensor or DRAM counters (DCGM profiling
     is datacenter-only), so those are not shown. */}
 <div className="flex flex-wrap border border-base-300 rounded-2xl overflow-hidden mb-4">
  <DeviceMetric label="Inference speed" help="Output tokens per second of wall time (image prefill included) for model calls this app made in the last minute: analysis windows, assistant and summaries. The yes/no scorer is not counted (one token per clip)." value={tps==null?null:one(tps)} unit="t/s" fraction={null} caption={inferenceCaption}/>
  <DeviceMetric label="SoC power" help="Live power draw of the accelerator, against the board's enforced limit." value={gpu?.powerWatts==null?null:gpu.powerWatts.toFixed(1)} unit="W" fraction={powerFraction} caption={gpu?.powerWatts==null?(gpu?"This board does not report power.":"No accelerator visible."):powerFraction==null?"Draw is live; no limit reported.":`${Math.round(powerFraction*100)}% of the ${Math.round(gpu.powerLimitWatts!)} W limit.`} tone={(powerFraction??0)>=.9?"bg-warning":"bg-primary"}/>
  <DeviceMetric label="Unified memory" help="On GB10 the CPU and GPU share one pool, so model weights and page cache draw on the same budget." value={host?.memoryUsedMb==null?null:one(gb(host.memoryUsedMb))} unit="GB" fraction={memFraction} caption={host?.memoryTotalMb?`${Math.round(memShare??0)}% of ${whole(gb(host.memoryTotalMb))} GB in use.`:"Memory is not readable on this host."} tone={(memShare??0)>=85?"bg-warning":"bg-secondary"}/>
 </div>

 <div className="rounded-xl bg-base-200/70 px-5 py-3.5 mb-8 text-sm text-base-content/65 flex flex-wrap gap-x-3 gap-y-1">
  <span className="font-mono text-xs uppercase tracking-[.06em] text-primary font-semibold self-center">Hardware-aware scheduling</span>
  <span>{host?.memoryTotalMb?`${whole(gb(host.memoryTotalMb))} GB unified model memory`:"Unified memory unreadable"} · {gpu?.powerLimitWatts?`${Math.round(gpu.powerLimitWatts)} W SoC compute profile`:"no power profile reported"}. Capacity and model launch eligibility follow these live readings, not a configured guess.</span>
 </div>

 {error&&<div className="mb-6"><Notice tone="error" role="alert">{error}</Notice></div>}
 {!error&&snapshot&&!gpu&&<div className="mb-6"><Notice tone="warning" role="alert">{snapshot.gpuUnavailableReason} Host metrics below are still live. Run the web app on the ZGX node to see accelerator readings.</Notice></div>}

 <div className="grid gap-10 xl:grid-cols-[1.35fr_1fr] mb-10">
  <Panel title="Accelerator" action={<span className="text-xs text-base-content/50 font-mono">{gpu?.name??"no GPU detected"}</span>}>
   <div className="grid grid-cols-3 gap-3 sm:gap-6 mb-6">
    <Gauge value={gpu?.utilisation??null} label="GPU utilisation" tone={load(gpu?.utilisation??null)}/>
    <Gauge value={vramShare} label={gpu?.memorySource==="processes"?"GPU memory (unified)":"GPU memory"} tone="text-secondary"/>
    <Gauge value={gpu?.temperatureC??null} label="Temperature" unit="°C" max={100} tone={(gpu?.temperatureC??0)>=80?"text-error":"text-accent"}/>
   </div>
   <div className="grid grid-cols-2 sm:grid-cols-3 border-t border-l border-base-300">
    <Readout label="Power" value={one(gpu?.powerWatts??null," W")} hint={gpu?.powerLimitWatts?`limit ${whole(gpu.powerLimitWatts)} W`:gpu?"no limit reported":undefined}/>
    <Readout label="SM clock" value={whole(gpu?.graphicsClockMhz??null," MHz")}/>
    <Readout label="Driver" value={gpu?.driver??"—"} hint="NVIDIA" className="col-span-2 sm:col-span-1"/>
   </div>
  </Panel>

  <Panel title="Host">
   <div className="space-y-5">
    <Meter label="CPU load" value={host?.cpuLoad??null} tone={(host?.cpuLoad??0)>=85?"bg-warning":"bg-primary"}/>
    <Meter label="Unified memory" value={memShare} tone={(memShare??0)>=85?"bg-warning":"bg-secondary"} caption={host?.memoryTotalMb?`${one(gb(host.memoryUsedMb))} / ${whole(gb(host.memoryTotalMb))} GB`:"unavailable"}/>
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 border-t border-l border-base-300">
     <Readout label="Load average" value={host?.loadAverage?host.loadAverage.map(v=>v.toFixed(2)).join("  "):"—"} hint="1m · 5m · 15m"/>
     <Readout label="Uptime" value={uptime(host?.uptimeSeconds??null)}/>
    </div>
   </div>
  </Panel>
 </div>

 <div className="grid gap-10 lg:grid-cols-2 mb-10">
  <Panel title="Recent activity" action={<span className="text-xs text-base-content/45">{history.length} samples · 3s interval</span>}>
   <div className="border-t border-base-300 pt-3 space-y-3">
    {[{label:"GPU utilisation",key:"gpu" as const,tone:"text-primary",unit:"%",icon:GaugeIcon},
      {label:"CPU load",key:"cpu" as const,tone:"text-secondary",unit:"%",icon:Cpu},
      {label:"Unified memory",key:"memory" as const,tone:"text-accent",unit:"%",icon:MemoryStick},
      {label:"GPU power",key:"power" as const,tone:"text-warning",unit:" W",icon:Zap}].map(({label,key,tone,unit,icon:Icon})=>{
     const values=history.map(p=>p[key]); const last=[...values].reverse().find(v=>v!=null)??null;
     return <div key={key} className="border-b border-base-300 pb-3">
      <div className="flex items-center justify-between gap-3 mb-1"><span className="flex items-center gap-2 text-sm text-base-content/70"><Icon size={15} className={tone}/>{label}</span><span className="font-mono text-sm tabular-nums">{last==null?"—":`${Math.round(last)}${unit}`}</span></div>
      <Sparkline values={values} tone={tone} label={label}/>
     </div>;})}
   </div>
  </Panel>

  <Panel title="GPU processes" action={<span className="text-xs text-base-content/45">{gpu?`${gpu.processes.length} compute ${gpu.processes.length===1?"process":"processes"}`:""}</span>}>
   {!gpu?<EmptyState title="No accelerator detected" description={snapshot?.gpuUnavailableReason??"Waiting for the first reading from the node."}/>
   :gpu.processes.length?<div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>PID</th><th>Process</th><th className="text-right">GPU memory</th></tr></thead>
    <tbody>{gpu.processes.map(p=><tr key={p.pid}><td className="font-mono">{p.pid}</td><td className="max-w-md truncate">{p.name}</td><td className="text-right font-mono tabular-nums">{p.memoryMb==null?"—":`${one(gb(p.memoryMb))} GB`}</td></tr>)}</tbody></table></div>
   :<EmptyState title="No compute processes" description="Nothing is using the accelerator right now. Start an inference run and it will appear here."/>}
  </Panel>
 </div>

 <div className="grid sm:grid-cols-2 lg:grid-cols-4 border-t border-l border-base-300 mt-10">
  <Readout label="Node" value={host?.hostname??"—"} hint={host?`${host.platform} · ${host.arch}`:undefined}/>
  <Readout label="CPU" value={host?.cpuCount?`${host.cpuCount} cores`:"—"} hint={host?.cpuModel??undefined}/>
  <Readout label="GPU memory" value={gpu?.memoryTotalMb?`${whole(gb(gpu.memoryTotalMb))} GB`:"—"} hint={gpu?.memoryUsedMb!=null?`${one(gb(gpu.memoryUsedMb))} GB in use${gpuMemHint?" by processes":""}`:undefined}/>
  <Readout label="System memory" value={host?.memoryTotalMb?`${whole(gb(host.memoryTotalMb))} GB`:"—"} hint="GB10 shares one pool with the GPU"/>
 </div>
 <p className="text-xs text-base-content/45 mt-4 flex items-center gap-1.5"><HardDrive size={13}/><Thermometer size={13}/>Readings are sampled on the server every 3 seconds and cached for one second, so several viewers do not multiply the load on the node.</p>
 </>;
}
