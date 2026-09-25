"""Side-by-side box review page (plan: model/.plans/local-vlm-quality.md, Phases 3 and 6).

Picks incidents where the reference model and the candidate flagged the same moment (same video,
key frames within 2 s), draws the reference box, the candidate's raw box and its YOLO-snapped box on
the reference's key frame, and writes a self-contained HTML page (frames embedded) under data/,
which is git-ignored because it contains UCF-Crime footage.

  python3 model/YOLO/src/box_review.py \
    --ref google__gemini-2.5-flash --cand qwen3-vl-30b-a3b__local --limit 12
"""

import argparse
import base64
import html
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw

RESULTS = Path("model/openrouter-bakeoff/results")
FRAMES = Path("data/bakeoff/frames")
COLOURS = {"ref": (66, 133, 244), "raw": (234, 67, 53), "yolo": (52, 168, 83)}


def incidents(stem: str):
    last = {}
    for line in open(RESULTS / f"{stem}.jsonl"):
        r = json.loads(line)
        last[(r["video"], r["start"])] = r
    out = {}
    for r in last.values():
        if r.get("ok"):
            for i in r["result"]["incidents"]:
                if i["confidence"] >= 0.5:
                    out.setdefault(r["video"], []).append({**i, "summary": r["result"]["summary"]})
    return out


def draw(img: Image.Image, boxes):
    scale = 2
    img = img.resize((img.width * scale, img.height * scale))
    d = ImageDraw.Draw(img)
    for key, box in boxes:
        if not box:
            continue
        x, y, w, h = box["x"] * img.width, box["y"] * img.height, box["width"] * img.width, box["height"] * img.height
        d.rectangle([x, y, x + w, y + h], outline=COLOURS[key], width=3)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="google__gemini-2.5-flash")
    ap.add_argument("--cand", default="qwen3-vl-30b-a3b__local")
    ap.add_argument("--limit", type=int, default=12)
    ap.add_argument("--out", type=Path, default=Path("data/bakeoff/review/boxes.html"))
    args = ap.parse_args()
    ref, raw, yolo = incidents(args.ref), incidents(args.cand), incidents(args.cand + "__yolo")
    pairs = []
    for video, refs in sorted(ref.items()):
        for r in refs:
            near = [c for c in raw.get(video, []) if abs(c["seconds"] - r["seconds"]) <= 2]
            if not near:
                continue
            c = min(near, key=lambda c: abs(c["seconds"] - r["seconds"]))
            y = next((v for v in yolo.get(video, []) if v["seconds"] == c["seconds"] and v["category"] == c["category"]), None)
            pairs.append((video, r, c, y))
            break  # one moment per video keeps the page varied
    cards = []
    for video, r, c, y in pairs[: args.limit]:
        frame = FRAMES / video / f"{float(r['seconds']):.2f}.jpg"
        if not frame.exists():
            continue
        img = draw(Image.open(frame).convert("RGB"), [("ref", r.get("box")), ("raw", c.get("box")), ("yolo", y.get("box") if y else None)])
        cards.append(f"""<figure><img src="data:image/png;base64,{img}" alt="{html.escape(video)} at {r['seconds']:.1f} s">
<figcaption><b>{html.escape(video)}</b> · {r['seconds']:.1f} s<br>
<span class="ref">■ Reference</span> {html.escape(r['category'])} ({r['confidence']:.2f}): {html.escape(r['description'])}<br>
<span class="raw">■ Candidate</span> / <span class="yolo">■ +YOLO</span> {html.escape(c['category'])} ({c['confidence']:.2f}): {html.escape(c['description'])}</figcaption></figure>""")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(f"""<!doctype html><meta charset="utf-8"><title>Box review</title>
<style>body{{font:14px system-ui;margin:16px;background:#fafafa;color:#222}}main{{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}}
figure{{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden}}img{{width:100%;display:block}}figcaption{{padding:8px;line-height:1.4}}
.ref{{color:rgb{COLOURS['ref']}}}.raw{{color:rgb{COLOURS['raw']}}}.yolo{{color:rgb{COLOURS['yolo']}}}</style>
<h1>Box review: {html.escape(args.ref)} vs {html.escape(args.cand)}</h1>
<p><span class="ref">■ Blue: reference</span> · <span class="raw">■ Red: candidate raw</span> · <span class="yolo">■ Green: candidate snapped to YOLO person</span>.
For each frame: which box best marks the person doing the incident?</p><main>{''.join(cards)}</main>""")
    print(f"wrote {args.out} ({len(cards)} moments)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
