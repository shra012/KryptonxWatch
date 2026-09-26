// Server-only: the demo clips (UCF-Crime) that "Load demo clips" copies into a browser.
// DEMO_CLIPS_DIR overrides the folder; the default is data/demo-clips (12 UCF-Crime clips).
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Clips taken out of the demo set (the model did not identify them correctly). Recordings of these files are removed from browsers. */
export const excludedClipsDir = () => path.resolve(process.cwd(), process.env.DEMO_EXCLUDED_DIR || "../data/demo-clips-excluded");
export const demoClipsDir = () => path.resolve(process.cwd(), process.env.DEMO_CLIPS_DIR || "../data/demo-clips");

// Display order: shoplifting, fighting, robbery, stealing, vandalism; clips not listed follow alphabetically.
const ORDER = ["Shoplifting0", "Shoplifting1", "Shoplifting2", "Fighting0", "Fighting1", "Fighting2", "Fighting3", "Robbery1", "Robbery2", "Robbery3", "Stealing1", "Vandalism3"];
const CLIP = /^[A-Za-z0-9_-]+\.(mp4|webm)$/;

export interface DemoClip { file: string; title: string }

/** Clips on disk, or null when the folder is missing. */
export async function listDemoClips(): Promise<DemoClip[] | null> {
  let files: string[];
  try { files = await readdir(demoClipsDir()); } catch { return null; }
  const rank = (f: string) => { const i = ORDER.indexOf(path.parse(f).name); return i < 0 ? ORDER.length : i; };
  return files.filter(f => CLIP.test(f)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map(file => ({ file, title: path.parse(file).name }));
}

/** File sizes of the excluded clips: a recording with the same size and a clip-like name is one of them. */
export async function excludedClipSizes(): Promise<number[]> {
  let files: string[];
  try { files = await readdir(excludedClipsDir()); } catch { return []; }
  return Promise.all(files.filter(f => CLIP.test(f)).map(async f => (await stat(path.join(excludedClipsDir(), f))).size));
}
