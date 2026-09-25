// Which response a suspected incident calls for: emergency services, or the shop owner.
// Pure, so the Overview, the Live monitor and tests agree. A person always confirms; nothing is sent on its own.
import type { Category, Detection } from "./types";

export type ResponseKind = "911" | "owner";

/** Danger to people: offer a 911 call. Everything else goes to the owner. Queue tracking is a measurement, not an incident. */
const EMERGENCY: ReadonlySet<Category> = new Set(["Robbery", "Fighting", "Gun", "Medical emergency"]);

export function responseFor(category: Category): ResponseKind | null {
  if (category === "Queue tracking") return null;
  return EMERGENCY.has(category) ? "911" : "owner";
}

/** Emergencies first, then severity, then the most confident. */
export function responsePriority(d: Pick<Detection, "category" | "severity" | "confidence">): number {
  const sev = { critical: 4, high: 3, medium: 2, low: 1, measurement: 0 }[d.severity];
  return (responseFor(d.category) === "911" ? 100 : 0) + sev * 10 + (d.confidence ?? 0.5);
}

/** A reference the operator can quote, e.g. SM-20260925-4821. */
export function responseReference(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `SM-${day}-${String(Math.floor(1000 + Math.random() * 9000))}`;
}
