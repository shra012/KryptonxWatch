"""Person boxes over HTTP for the web app (plan: webapp/.plans/yolo-boxes-in-app.md).

POST /detect  {"images": ["data:image/jpeg;base64,...", ...], "conf": 0.25}
          ->  {"persons": [[{"x", "y", "width", "height", "score"}, ...], ...]}   (one list per image, normalised 0-1)
GET  /health  ->  {"ok": true, "weights": "...", "device": "..."}

The app (app/api/analyze) snaps the VLM's incident box to these persons and follows that person across the
window's frames. Set YOLO_BASE_URL=http://127.0.0.1:8090 in webapp/.env.local.

  GB10:  docker run --rm --runtime=nvidia --gpus all -p 127.0.0.1:8090:8090 \
           -v /srv/kryptonx-data/models/yolo:/weights:ro -v "$PWD":/workspace -w /workspace kryptonx/yolo:dev \
           python model/YOLO/src/yolo_server.py --weights /weights/yolo11m.pt --host 0.0.0.0
  Laptop: pip install ultralytics && python model/YOLO/src/yolo_server.py   (downloads yolo11n.pt, CPU or Apple GPU)
"""

import argparse
import base64
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from PIL import Image
from ultralytics import YOLO

# cuDNN 9.20 in the NGC 26.03 image returns no detections for YOLO on the GB10 (sm_121); see yolo_snap.py.
torch.backends.cudnn.enabled = False

MAX_IMAGES = 16
MAX_BODY = 40_000_000


def pick_device() -> str:
    if torch.cuda.is_available():
        return "0"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="yolo11n.pt")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8090)
    args = ap.parse_args()
    model = YOLO(args.weights)
    device = pick_device()
    lock = threading.Lock()  # one batch on the GPU at a time

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send(self, code: int, body: dict):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self.send(200, {"ok": True, "weights": args.weights, "device": device})
            else:
                self.send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/detect":
                return self.send(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 < length <= MAX_BODY:
                return self.send(413, {"error": "body too large"})
            try:
                req = json.loads(self.rfile.read(length))
                urls = req["images"]
                if not isinstance(urls, list) or not 0 < len(urls) <= MAX_IMAGES:
                    return self.send(400, {"error": f"send 1-{MAX_IMAGES} images"})
                images = [Image.open(io.BytesIO(base64.b64decode(u.split(",", 1)[1]))).convert("RGB") for u in urls]
                conf = float(req.get("conf", 0.25))
            except Exception as e:  # malformed request
                return self.send(400, {"error": f"bad request: {e}"})
            with lock:
                results = model.predict(images, classes=[0], conf=conf, device=device, verbose=False)
            persons = [[{"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1, "score": s}
                        for (x1, y1, x2, y2), s in zip(r.boxes.xyxyn.tolist(), r.boxes.conf.tolist())] for r in results]
            self.send(200, {"persons": persons})

    print(f"YOLO person boxes on http://{args.host}:{args.port} ({args.weights}, device {device})", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
