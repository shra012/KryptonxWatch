// Verified analyses for demo clips, replayed instead of calling the model so the presentation is the same every time.
// Robbery2 (UCF-Crime, 320x240, 32 s): detections and scene log from google/gemini-3.8-flash, the suspect tracked with YOLO
// every 0.5 s and checked frame by frame (entry 4.25 s, at the counter to 25.75 s, hidden behind customers ~23 s,
// out of view 26-30 s, leaving past the camera 30.25-30.75 s). Boxes are 0-1 of the frame.
import type { Detection, Keyframe, Moment, VideoRecord } from "../types";

export interface CuratedAnalysis { model: string; detections: Omit<Detection, "id" | "videoId" | "status">[]; moments: Moment[] }

type Box = { x: number; y: number; width: number; height: number };
const withLabel = (label: string, kfs: { seconds: number; box: Box; trackId: string }[]): Keyframe[] => kfs.map(k => ({ ...k, box: { ...k.box, label } }));

// The robber (camouflage jacket, white face covering, cap), one box per 0.5 s while in view.
const ROBBER: { seconds: number; box: Box; trackId: string }[] = [
  {"seconds":4.25,"box":{"x":0.3059,"y":0.7384,"width":0.3477,"height":0.2608},"trackId":"robber"},
  {"seconds":4.75,"box":{"x":0.2062,"y":0.6085,"width":0.3293,"height":0.3908},"trackId":"robber"},
  {"seconds":5.25,"box":{"x":0.1463,"y":0.4835,"width":0.2013,"height":0.5153},"trackId":"robber"},
  {"seconds":5.75,"box":{"x":0.193,"y":0.4208,"width":0.1576,"height":0.5783},"trackId":"robber"},
  {"seconds":6.25,"box":{"x":0.2203,"y":0.3722,"width":0.1529,"height":0.6273},"trackId":"robber"},
  {"seconds":6.75,"box":{"x":0.2205,"y":0.357,"width":0.1505,"height":0.6415},"trackId":"robber"},
  {"seconds":7.25,"box":{"x":0.1997,"y":0.3767,"width":0.192,"height":0.6221},"trackId":"robber"},
  {"seconds":7.75,"box":{"x":0.1911,"y":0.3709,"width":0.1642,"height":0.6288},"trackId":"robber"},
  {"seconds":8.25,"box":{"x":0.1398,"y":0.3744,"width":0.2153,"height":0.6244},"trackId":"robber"},
  {"seconds":8.75,"box":{"x":0.1001,"y":0.3706,"width":0.1609,"height":0.6283},"trackId":"robber"},
  {"seconds":9.25,"box":{"x":0.1058,"y":0.3598,"width":0.1639,"height":0.6386},"trackId":"robber"},
  {"seconds":9.75,"box":{"x":0.0975,"y":0.3808,"width":0.176,"height":0.6175},"trackId":"robber"},
  {"seconds":10.25,"box":{"x":0.0893,"y":0.3536,"width":0.195,"height":0.6451},"trackId":"robber"},
  {"seconds":10.75,"box":{"x":0.0963,"y":0.3591,"width":0.192,"height":0.6399},"trackId":"robber"},
  {"seconds":11.25,"box":{"x":0.1455,"y":0.3487,"width":0.2219,"height":0.6507},"trackId":"robber"},
  {"seconds":11.75,"box":{"x":0.1794,"y":0.3655,"width":0.1496,"height":0.6329},"trackId":"robber"},
  {"seconds":13.25,"box":{"x":0.2563,"y":0.3831,"width":0.2429,"height":0.616},"trackId":"robber"},
  {"seconds":13.75,"box":{"x":0.3186,"y":0.3713,"width":0.2633,"height":0.6274},"trackId":"robber"},
  {"seconds":14.75,"box":{"x":0.5893,"y":0.3495,"width":0.1986,"height":0.6486},"trackId":"robber"},
  {"seconds":15.25,"box":{"x":0.6158,"y":0.4354,"width":0.2356,"height":0.564},"trackId":"robber"},
  {"seconds":16.25,"box":{"x":0.7002,"y":0.3361,"width":0.1648,"height":0.6628},"trackId":"robber"},
  {"seconds":16.75,"box":{"x":0.6455,"y":0.3267,"width":0.2232,"height":0.6603},"trackId":"robber"},
  {"seconds":17.25,"box":{"x":0.6376,"y":0.2933,"width":0.1839,"height":0.6579},"trackId":"robber"},
  {"seconds":17.75,"box":{"x":0.6301,"y":0.3045,"width":0.2278,"height":0.6478},"trackId":"robber"},
  {"seconds":18.25,"box":{"x":0.6069,"y":0.2946,"width":0.2434,"height":0.6561},"trackId":"robber"},
  {"seconds":18.75,"box":{"x":0.6439,"y":0.2939,"width":0.2019,"height":0.6573},"trackId":"robber"},
  {"seconds":19.25,"box":{"x":0.634,"y":0.3281,"width":0.2495,"height":0.6251},"trackId":"robber"},
  {"seconds":19.75,"box":{"x":0.6491,"y":0.2916,"width":0.2598,"height":0.6699},"trackId":"robber"},
  {"seconds":20.25,"box":{"x":0.6485,"y":0.2902,"width":0.2712,"height":0.6668},"trackId":"robber"},
  {"seconds":20.75,"box":{"x":0.6339,"y":0.2821,"width":0.2548,"height":0.6752},"trackId":"robber"},
  {"seconds":21.25,"box":{"x":0.6413,"y":0.248,"width":0.2495,"height":0.7142},"trackId":"robber"},
  {"seconds":21.75,"box":{"x":0.6375,"y":0.2869,"width":0.2258,"height":0.6723},"trackId":"robber"},
  {"seconds":22.25,"box":{"x":0.6484,"y":0.3044,"width":0.2115,"height":0.6566},"trackId":"robber"},
  {"seconds":22.75,"box":{"x":0.6394,"y":0.3332,"width":0.2265,"height":0.6278},"trackId":"robber"},
  {"seconds":24.25,"box":{"x":0.6411,"y":0.3278,"width":0.2176,"height":0.6301},"trackId":"robber"},
  {"seconds":24.75,"box":{"x":0.6441,"y":0.2949,"width":0.2043,"height":0.6612},"trackId":"robber"},
  {"seconds":25.25,"box":{"x":0.6449,"y":0.3096,"width":0.2088,"height":0.6458},"trackId":"robber"},
  {"seconds":25.75,"box":{"x":0.6364,"y":0.315,"width":0.2202,"height":0.6415},"trackId":"robber"},
  {"seconds":30.25,"box":{"x":0.1618,"y":0.7393,"width":0.2659,"height":0.2598},"trackId":"robber-exit"},
  {"seconds":30.75,"box":{"x":0.3241,"y":0.7305,"width":0.1753,"height":0.2683},"trackId":"robber-exit"},
];

const robbery2: CuratedAnalysis = {
  model: "google/gemini-3.8-flash",
  detections: [
    { category: "Robbery", severity: "critical", confidence: 0.95, seconds: 5.25, endSeconds: 25.75, model: "google/gemini-3.8-flash",
      description: "A masked man in a camouflage jacket aims a handgun across the counter at the clerk, forces a customer to the floor and takes goods from the register area.",
      box: { ...ROBBER.find(k => k.seconds === 9.25)!.box, label: "Robbery" }, keyframes: withLabel("Robbery", ROBBER) },
    { category: "Gun", severity: "critical", confidence: 0.92, seconds: 5.25, endSeconds: 15.25, model: "google/gemini-3.8-flash",
      description: "A handgun is pointed at the clerk behind the counter.",
      box: { ...ROBBER.find(k => k.seconds === 9.25)!.box, label: "Gun" }, keyframes: withLabel("Gun", ROBBER.filter(k => k.seconds >= 4.25 && k.seconds <= 15.25)) },
  ],
  moments: [
    { start: 0, end: 8, summary: "A masked man in a camouflage jacket enters with a handgun raised; the clerk backs away and the customers turn." },
    { start: 8, end: 16, summary: "The masked man points the handgun at the clerk and a customer, who drops to the floor, in an armed robbery." },
    { start: 16, end: 24, summary: "The robber leans over the counter taking goods while the clerk complies; other customers keep their distance." },
    { start: 24, end: 32, summary: "The robber leaves the counter and walks out past the camera; the customers get up and speak to the clerk." },
  ],
};

// Keyed by file size and duration, which needs no hashing (crypto.subtle is missing when the app is opened by IP over HTTP).
const CURATED: { size: number; duration: number; analysis: CuratedAnalysis }[] = [
  { size: 1404666, duration: 32.02, analysis: robbery2 },
];

/** The verified analysis for this recording, if it is one of the demo clips. */
export function curatedFor(video: Pick<VideoRecord, "size" | "blob">, duration: number): CuratedAnalysis | undefined {
  const size = video.size ?? video.blob?.size;
  return CURATED.find(c => c.size === size && Math.abs(c.duration - duration) < 0.2)?.analysis;
}
