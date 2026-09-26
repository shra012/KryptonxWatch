"use client";
// Automatic 911 calls for emergencies (robbery, fighting, gun, medical emergency), shown as a small call panel in
// the corner. No confirmation: an analysis that finds an emergency (video page, demo-clip loader, Live monitor)
// starts the call at once. The call is simulated for the demo; the outcome is saved on the detection as a response.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, Phone, X } from "lucide-react";
import { useApp } from "./app-provider";
import { responseFor, responsePriority, responseReference } from "@/lib/response";
import { isSecurityDetection, timecode, type Detection, type ResponseRecord } from "@/lib/types";
import { INCIDENT_THRESHOLD } from "@/lib/vlm/analysis";

export interface CallRequest {
  id: string;
  detection: Pick<Detection, "category" | "seconds" | "description" | "confidence">;
  place: string;
  onDone?: (record: ResponseRecord) => void;
}

const CallContext = createContext<{ call: (req: CallRequest) => void } | null>(null);
export function useCallCenter() { const ctx = useContext(CallContext); if (!ctx) throw new Error("CallCenterProvider is required"); return ctx; }

const SEEN = "sm-autocall-seen";
const read = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN) || "[]"); } catch { return []; } };
const write = (keys: string[]) => { try { localStorage.setItem(SEEN, JSON.stringify(keys.slice(-500))); } catch { /* per-browser convenience only */ } };

export function CallCenterProvider({ children }: { children: React.ReactNode }) {
  const { videos, loading, saveVideo } = useApp();
  const [queue, setQueue] = useState<CallRequest[]>([]);
  const call = useCallback((req: CallRequest) => setQueue(q => q.some(x => x.id === req.id) ? q : [...q, req]), []);
  const latest = useRef(videos); latest.current = videos;

  // Every finished analysis with an emergency calls once. Keyed by the analysis run (analyzedAt), so re-running a
  // recording calls again, while analyses from before this feature (no analyzedAt) never do.
  useEffect(() => {
    if (loading) return;
    const seen = read();
    const fresh = videos.flatMap(v => {
      const key = `${v.id}@${v.analyzedAt}`;
      if (v.source !== "upload" || !v.analyzedAt || seen.includes(key)) return [];
      const emergencies = v.detections.filter(d => isSecurityDetection(d) && responseFor(d.category) === "911" && !d.response && (d.confidence ?? 1) >= INCIDENT_THRESHOLD);
      return [{ key, video: v, emergencies }];
    });
    if (!fresh.length) return;
    write([...seen, ...fresh.map(f => f.key)]);
    for (const { key, video, emergencies } of fresh) {
      const top = [...emergencies].sort((a, b) => responsePriority(b) - responsePriority(a))[0];
      if (!top) continue;
      const ids = new Set(emergencies.map(d => d.id));
      call({ id: key, detection: top, place: video.title, onDone: record => {
        const v = latest.current.find(x => x.id === video.id);
        if (v) saveVideo({ ...v, detections: v.detections.map(d => ids.has(d.id) && !d.response ? { ...d, response: record } : d) }).catch(() => {});
      } });
    }
  }, [loading, videos, call, saveVideo]);

  return <CallContext.Provider value={{ call }}>
    {children}
    {queue[0] && <CallPanel key={queue[0].id} req={queue[0]} waiting={queue.length - 1} onClose={() => setQueue(q => q.slice(1))} />}
  </CallContext.Provider>;
}

type Phase = "dialing" | "connected" | "done";

/** The small call panel: dialling, connected with what is shared, then the reference. Closes itself when done. */
function CallPanel({ req, waiting, onClose }: { req: CallRequest; waiting: number; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("dialing");
  const [clock, setClock] = useState(0);
  const [record, setRecord] = useState<ResponseRecord | null>(null);
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return; done.current = true;
    const r: ResponseRecord = { kind: "911", at: new Date().toISOString(), reference: responseReference(), outcome: "Dispatcher notified automatically" };
    setRecord(r); setPhase("done"); req.onDone?.(r);
  }, [req]);
  useEffect(() => { const t = setTimeout(() => setPhase("connected"), 2500); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (phase === "connected") { const t = setInterval(() => setClock(c => c + 1), 1000); return () => clearInterval(t); }
    if (phase === "done") { const t = setTimeout(onClose, 6000); return () => clearTimeout(t); }
  }, [phase, onClose]);
  useEffect(() => { if (phase === "connected" && clock >= 6) finish(); }, [phase, clock, finish]);

  const d = req.detection;
  const lines = [`Location shared: ${req.place}`, `Suspected ${d.category.toLowerCase()} at ${timecode(d.seconds)}`, "Camera still and description sent", "Dispatcher acknowledged"];
  return <div role="alert" aria-live="assertive" className="fixed bottom-4 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-base-100 border border-base-300 border-t-4 border-t-error shadow-2xl overflow-hidden fade-in">
    <div className="p-4">
      <div className="flex items-center gap-3">
        <span className="relative grid place-items-center size-10 shrink-0">
          {phase !== "done" && <span className="absolute inset-0 rounded-full bg-error/25 motion-safe:animate-ping" />}
          <span className={`relative grid place-items-center size-9 rounded-full ${phase === "done" ? "bg-base-200" : "bg-error text-error-content"}`}>{phase === "done" ? <Check size={17} /> : <Phone size={16} />}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{phase === "dialing" ? "Calling 911…" : phase === "connected" ? `911 · connected ${timecode(clock)}` : "911 notified"}</p>
          <p className="text-xs text-base-content/60 truncate">Suspected {d.category.toLowerCase()} · {req.place}</p>
        </div>
        <button className="btn btn-ghost btn-xs btn-circle" aria-label="Close" onClick={() => { finish(); onClose(); }}><X size={14} /></button>
      </div>
      {phase === "connected" && <ul className="mt-3 space-y-1 text-xs">{lines.slice(0, Math.min(lines.length, clock + 1)).map(l => <li key={l} className="flex items-start gap-1.5 fade-in"><Check size={12} className="mt-0.5 shrink-0" />{l}</li>)}</ul>}
      {phase === "done" && record && <p className="mt-2 text-xs text-base-content/65">{record.outcome} · <span className="font-mono">{record.reference}</span></p>}
      {waiting > 0 && <p className="mt-2 text-[.7rem] text-base-content/50">{waiting} more {waiting === 1 ? "call" : "calls"} queued</p>}
    </div>
    <p className="px-4 py-1.5 bg-base-200 text-[.62rem] text-base-content/45 border-t border-base-300">Demo: no real 911 call is placed.</p>
  </div>;
}
