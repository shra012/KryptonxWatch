"use client";
// The response pop-up for a suspected incident: call 911 for danger to people, notify the owner otherwise.
// A person confirms every step. The 911 call is simulated for the demo; owner messages use /api/alerts when it is configured.
import { useEffect, useRef, useState } from "react";
import { BellRing, Check, MessageSquare, Phone, PhoneOff, ShieldAlert, X } from "lucide-react";
import { SeverityBadge } from "./ui";
import { alertForDetection, type AlertStatus } from "@/lib/alert-client";
import { responseFor, responseReference } from "@/lib/response";
import { timecode, type AlertRecipient, type Detection, type ResponseRecord } from "@/lib/types";

export interface ResponseIncident {
  detection: Pick<Detection, "id" | "videoId" | "seconds" | "category" | "severity" | "description" | "confidence">;
  /** Camera or recording name, shown as the location. */
  place: string;
  /** Sample footage: owner messages are prefixed [SIMULATED]. */
  sample?: boolean;
  /** The address this recording opted in with, instead of the owner number. */
  recipient?: AlertRecipient;
}

type Phase = "ask" | "dialing" | "connected" | "sending" | "done";

// What the dispatcher screen shows as the call goes on, one line a second.
const SHARED = (i: ResponseIncident) => [
  `Location shared: ${i.place}`,
  `Incident: suspected ${i.detection.category.toLowerCase()} at ${timecode(i.detection.seconds)}`,
  "Camera still and description attached",
  "Dispatcher acknowledged; stay on site and keep the area clear",
];

export function ResponseDialog({ incident, alertStatus, more = 0, onDone, onClose }: {
  incident: ResponseIncident; alertStatus?: AlertStatus | null; more?: number;
  onDone: (record: ResponseRecord) => void; onClose: () => void;
}) {
  const kind = responseFor(incident.detection.category) ?? "owner";
  const [phase, setPhase] = useState<Phase>("ask");
  const [clock, setClock] = useState(0);
  const [record, setRecord] = useState<ResponseRecord | null>(null);
  const [note, setNote] = useState("");
  const primary = useRef<HTMLButtonElement>(null);
  const d = incident.detection;

  useEffect(() => { primary.current?.focus(); }, [phase]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && (phase === "ask" || phase === "done")) onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);
  // Dialing rings for a moment, then the call timer runs while connected.
  useEffect(() => {
    if (phase === "dialing") { const t = setTimeout(() => { setPhase("connected"); setClock(0); }, 2200); return () => clearTimeout(t); }
    if (phase === "connected") { const t = setInterval(() => setClock(c => c + 1), 1000); return () => clearInterval(t); }
  }, [phase]);

  function finish(outcome: string) {
    const r: ResponseRecord = { kind, at: new Date().toISOString(), reference: responseReference(), outcome };
    setRecord(r); setPhase("done"); onDone(r);
  }

  async function notifyOwner() {
    setPhase("sending");
    if (alertStatus?.configured) {
      const r = await alertForDetection(d, incident.place, !!incident.sample, incident.recipient);
      if (r.outcome === "sent" || r.outcome === "duplicate") finish(r.outcome === "sent" ? `Owner texted at ${alertStatus.ownerMasked ?? "the number on file"}` : "Owner was already notified");
      else { setNote(r.message); setPhase("ask"); }
      return;
    }
    await new Promise(r => setTimeout(r, 1400));
    finish("Owner notified by text message");
  }

  const shared = SHARED(incident).slice(0, Math.min(4, clock + 1));
  const emergency = kind === "911";
  return <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/35 fade-in" role="presentation">
    <div role="alertdialog" aria-modal="true" aria-labelledby="response-title" aria-describedby="response-desc"
      className={`w-full max-w-md rounded-2xl bg-base-100 border border-base-300 shadow-2xl overflow-hidden border-t-4 ${emergency ? "border-t-error" : "border-t-warning"}`}>
      <div className="p-6">
        <div className="flex items-start justify-between gap-3">
          <span className={`flex items-center gap-2 font-mono text-[.66rem] uppercase tracking-[.08em] ${emergency ? "text-error" : "text-warning"}`}>
            {emergency ? <ShieldAlert size={14} /> : <BellRing size={14} />}{emergency ? "Emergency response" : "Owner notification"}
          </span>
          {(phase === "ask" || phase === "done") && <button className="btn btn-ghost btn-xs btn-circle" onClick={onClose} aria-label="Close"><X size={15} /></button>}
        </div>

        {phase === "ask" && <>
          <h2 id="response-title" className="text-xl font-semibold tracking-tight mt-3">Suspected {d.category.toLowerCase()}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-sm"><SeverityBadge severity={d.severity} /><span className="font-mono text-xs text-base-content/55">{d.confidence != null ? `${Math.round(d.confidence * 100)}% confidence · ` : ""}{incident.place} · {timecode(d.seconds)}</span></div>
          <p id="response-desc" className="text-sm text-base-content/70 mt-3">{d.description}</p>
          <p className="text-sm mt-4">{emergency ? "This looks like danger to people. Check the footage, then call emergency services." : "Let the shop owner know so they can check the footage and decide what to do."}</p>
          {note && <p role="alert" className="text-sm text-error mt-3">{note}</p>}
          <div className="flex flex-wrap gap-2 mt-6">
            {emergency
              ? <button ref={primary} className="btn btn-error" onClick={() => setPhase("dialing")}><Phone size={16} />Call 911</button>
              : <button ref={primary} className="btn btn-primary" onClick={notifyOwner}><MessageSquare size={16} />Notify shop owner</button>}
            <button className="btn btn-outline" onClick={onClose}>Not now</button>
          </div>
          {more > 0 && <p className="text-xs text-base-content/50 mt-4">{more} more {more === 1 ? "incident is" : "incidents are"} waiting for a response.</p>}
        </>}

        {(phase === "dialing" || phase === "connected") && <div className="text-center py-2">
          <div className="relative mx-auto size-20 mt-4 grid place-items-center">
            <span className="absolute inset-0 rounded-full bg-error/20 motion-safe:animate-ping" />
            <span className="relative grid place-items-center size-16 rounded-full bg-error text-error-content"><Phone size={26} /></span>
          </div>
          <h2 id="response-title" className="text-2xl font-semibold tracking-tight mt-5">911</h2>
          <p className="font-mono text-sm text-base-content/60 mt-1" aria-live="polite">{phase === "dialing" ? "Calling emergency services…" : `Connected · ${timecode(clock)}`}</p>
          {phase === "connected" && <ul className="text-left text-sm mt-6 space-y-2 border-t border-base-300 pt-4" aria-live="polite">
            {shared.map(line => <li key={line} className="flex items-start gap-2 fade-in"><Check size={15} className="mt-0.5 shrink-0" />{line}</li>)}
          </ul>}
          <button ref={primary} className="btn btn-error mt-6" onClick={() => finish("Dispatcher notified")} disabled={phase === "dialing"}><PhoneOff size={16} />End call</button>
        </div>}

        {phase === "sending" && <div className="py-8 text-center"><span className="loading loading-spinner" /><p className="text-sm text-base-content/60 mt-3" aria-live="polite">Notifying the shop owner…</p></div>}

        {phase === "done" && record && <div className="py-2">
          <div className="grid place-items-center size-12 rounded-full bg-base-200 mt-3"><Check size={22} /></div>
          <h2 id="response-title" className="text-xl font-semibold tracking-tight mt-4">{emergency ? "Emergency services notified" : "Shop owner notified"}</h2>
          <p className="text-sm text-base-content/65 mt-2">{record.outcome} · {new Date(record.at).toLocaleTimeString()}</p>
          <p className="font-mono text-sm mt-3">Reference {record.reference}</p>
          <button ref={primary} className="btn btn-primary mt-6" onClick={onClose}>Done</button>
        </div>}
      </div>
      <p className="px-6 py-2.5 bg-base-200 text-[.68rem] text-base-content/45 border-t border-base-300">{emergency ? "Demo: no real 911 call is placed." : alertStatus?.configured ? "Sent through the configured alert service." : "Demo: no message is sent until alerts are configured in Preferences."}</p>
    </div>
  </div>;
}
