"use client";
// Body joints drawn over a live feed: a dashed box per person with its confidence, the skeleton, and the joints.
// Coordinates are 0-1 of the frame, so the overlay must sit exactly on the video (see --video-ratio on the Live page).

export interface Pose { names: string[]; persons: { x: number; y: number; width: number; height: number; score: number; keypoints: [number, number, number][] }[] }

// COCO skeleton: face, arms, torso, legs (joint indices as in yolo_server.py JOINTS).
const BONES = [[0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
const MIN_SCORE = 0.5;
// Joint names only on people tall enough to read them (a webcam close-up); on distant people they pile up.
const NAMES_MIN_HEIGHT = 0.35;

export function PoseOverlay({ pose, labels }: { pose: Pose; labels: boolean }) {
  const seen = (k?: [number, number, number]) => !!k && k[2] >= MIN_SCORE;
  return <div className="absolute inset-0 pointer-events-none" aria-hidden>
    <svg className="absolute inset-0 size-full" viewBox="0 0 1 1" preserveAspectRatio="none">
      {pose.persons.map((p, i) => <g key={i}>{BONES.map(([a, b]) => seen(p.keypoints[a]) && seen(p.keypoints[b])
        ? <line key={`${a}-${b}`} x1={p.keypoints[a][0]} y1={p.keypoints[a][1]} x2={p.keypoints[b][0]} y2={p.keypoints[b][1]} stroke="#fff" strokeOpacity={.9} strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ filter: "drop-shadow(0 0 1px rgb(0 0 0 / .8))" }} />
        : null)}</g>)}
    </svg>
    {pose.persons.map((p, i) => <div key={i}>
      <div className="absolute border-[1.5px] border-dashed border-white/80 rounded-md" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.width * 100}%`, height: `${p.height * 100}%` }}>
        <span className="absolute left-0 bottom-full mb-0.5 whitespace-nowrap font-mono text-[.62rem] text-white drop-shadow-[0_1px_1px_rgb(0_0_0/.9)]">person {Math.round(p.score * 100)}%</span>
      </div>
      {p.keypoints.map((k, j) => seen(k) && <span key={j} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${k[0] * 100}%`, top: `${k[1] * 100}%` }}>
        <span className="block size-2.5 rounded-full bg-white ring-2 ring-black/70" />
        {labels && p.height >= NAMES_MIN_HEIGHT && <span className="absolute left-3 -top-1 whitespace-nowrap font-mono text-[.58rem] text-white drop-shadow-[0_1px_1px_rgb(0_0_0/.9)]">{pose.names[j]}</span>}
      </span>)}
    </div>)}
  </div>;
}
