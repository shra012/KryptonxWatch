import { type AssistantReply, type Detection, type VideoRecord } from "./types";
const make = (videoId: string, id: string, seconds: number, category: Detection["category"], severity: Detection["severity"], description: string, box?: Detection["box"]): Detection => ({ id, videoId, seconds, category, severity, status: "new", description, box });
// Simulated demo recordings, off in the app. The e2e tests turn them on (NEXT_PUBLIC_DEMO_SAMPLES=1 in playwright.config.ts).
const demoSamples: VideoRecord[] = [
 { id:"sample-entrance", title:"Market entrance · simulated", recordedAt:"2026-09-22T10:15:00.000Z", duration:24, source:"sample", analysis:"demo", mediaPath:"/samples/market-entrance.webm", detections:[
  make("sample-entrance","sample-e1",5,"Queue tracking","measurement","Queue length estimate: 3 people", {x:.2,y:.23,width:.15,height:.54,label:"Queue area"}),
  make("sample-entrance","sample-e2",12,"Suspicious activity","medium","Unusual movement near entrance; review footage", {x:.51,y:.32,width:.13,height:.42,label:"Area of interest"}),
  make("sample-entrance","sample-e3",18,"Pickpocketing","high","Possible close-contact theft; human review needed", {x:.6,y:.3,width:.14,height:.45,label:"Area of interest"})
 ]},
 { id:"sample-checkout", title:"Self checkout · simulated", recordedAt:"2026-09-23T15:42:00.000Z", duration:24, source:"sample", analysis:"demo", mediaPath:"/samples/self-checkout.webm", detections:[
  make("sample-checkout","sample-c1",7,"Kiosk nonpayment","high","Possible item bypass at kiosk; human review needed", {x:.34,y:.33,width:.16,height:.43,label:"Checkout"}),
  make("sample-checkout","sample-c2",14,"Shoplifting","medium","Possible unscanned item; inspect this moment", {x:.59,y:.35,width:.13,height:.4,label:"Area of interest"}),
  make("sample-checkout","sample-c3",20,"Queue tracking","measurement","Queue length estimate: 2 people", {x:.65,y:.3,width:.16,height:.5,label:"Queue area"})
 ]}
];
export const sampleVideos: VideoRecord[] = process.env.NEXT_PUBLIC_DEMO_SAMPLES === "1" ? demoSamples : [];
export const demoDetectionService = { async analyze(): Promise<Detection[]> { throw new Error("A detection service is not connected. Uploaded videos are not analyzed."); } };
export const demoAssistantService = { async respond(video: VideoRecord, question: string): Promise<AssistantReply> {
 const q=question.toLowerCase();
 const events=video.detections.filter(d=>d.status!=="dismissed" && (q.includes("queue") ? d.category==="Queue tracking" : q.includes("high") ? d.severity==="high" || d.severity==="critical" : true));
 if(video.source!=="sample") return {text:"This uploaded video has no analysis yet. Connect a detection service before asking about its contents.",references:[]};
 if(!events.length) return {text:"The simulated annotations for this recording contain no matching events.",references:[]};
 return {text:"Demo answer based on simulated annotations: "+events.map(e=>`${e.category.toLowerCase()} at ${Math.floor(e.seconds/60)}:${String(e.seconds%60).padStart(2,"0")}`).join("; ")+". Review the video to confirm any suspected incident.", references:events.map(e=>({seconds:e.seconds,label:e.category}))};
 }};
