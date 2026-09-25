// Server-only: pack JPEG data-URL frames into an H.264 MP4 at a fixed frame rate with ffmpeg,
// for video-input models served by vLLM (the local shoplifting scorer).
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function framesToMp4DataUrl(images: string[], fps: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kxw-clip-"));
  try {
    await Promise.all(images.map((img, i) =>
      writeFile(join(dir, `f${String(i).padStart(3, "0")}.jpg`), Buffer.from(img.slice(img.indexOf(",") + 1), "base64"))));
    const out = join(dir, "clip.mp4");
    await new Promise<void>((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-v", "error", "-y", "-framerate", String(fps), "-i", join(dir, "f%03d.jpg"),
        // yuv420p needs even dimensions; qp 0 keeps the decoded frames identical to the JPEGs.
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", out,
      ]);
      let stderr = "";
      ff.stderr.on("data", d => { stderr += d; });
      ff.on("error", e => reject(new Error(`ffmpeg is required on the server for the local scorer: ${e.message}`)));
      ff.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(0, 300)}`)));
    });
    return `data:video/mp4;base64,${(await readFile(out)).toString("base64")}`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
