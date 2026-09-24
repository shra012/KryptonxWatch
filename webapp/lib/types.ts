export type Category = "Robbery" | "Theft" | "Shoplifting" | "Pickpocketing" | "Fighting" | "Vandalism" | "Gun" | "Queue tracking" | "Kiosk nonpayment" | "Medical emergency" | "Suspicious activity";
export type Severity = "critical" | "high" | "medium" | "low" | "measurement";
export type ReviewStatus = "new" | "reviewed" | "dismissed";
export type AnalysisStatus = "demo" | "not_analyzed" | "processing" | "complete" | "failed";
export interface BoundingBox { x: number; y: number; width: number; height: number; label: string }
export interface Detection { id: string; videoId: string; seconds: number; category: Category; severity: Severity; status: ReviewStatus; description: string; box?: BoundingBox; endSeconds?: number; confidence?: number; model?: string }
export interface VideoRecord { id: string; title: string; recordedAt: string; duration: number; source: "sample" | "upload"; analysis: AnalysisStatus; mediaPath?: string; blob?: Blob; size?: number; detections: Detection[]; analysisModel?: string; analysisError?: string; moments?: Moment[] }
export interface Moment { start: number; end: number; summary: string }
export interface AssistantReply { text: string; references: { seconds: number; label: string }[] }
export interface VideoRepository { list(): Promise<VideoRecord[]>; save(video: VideoRecord): Promise<void>; remove(id: string): Promise<void> }
export interface DetectionService { analyze(video: VideoRecord): Promise<Detection[]> }
export interface AssistantService { respond(video: VideoRecord, question: string): Promise<AssistantReply> }
export const categories: Category[] = ["Robbery","Theft","Shoplifting","Pickpocketing","Fighting","Vandalism","Gun","Queue tracking","Kiosk nonpayment","Medical emergency","Suspicious activity"];
export const severityOrder: Severity[] = ["critical","high","medium","low","measurement"];
export function timecode(seconds: number) { const s=Math.max(0,Math.floor(seconds)); return `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`; }
export function dateLabel(value: string) { return new Date(value).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }
export function isSecurityDetection(d: Detection) { return d.severity !== "measurement" && d.status !== "dismissed"; }
