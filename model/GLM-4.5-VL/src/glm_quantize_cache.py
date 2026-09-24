"""Quantize GLM-4.5V to NF4 once and save it, so later runs skip the ~13 min bf16 load.

Writes glm_common.NF4_DIR (~60 GB) with the quantization config embedded, plus
cache_info.json and a SHA-256 manifest of the written shards. Processor files stay in MODEL_DIR.

  docker run --rm --runtime=nvidia --gpus all --ipc=host \
    -v /srv/kryptonx-data:/srv/kryptonx-data -v "$PWD":/workspace -w /workspace kryptonx/glm:dev \
    python model/GLM-4.5-VL/src/glm_quantize_cache.py
"""

import hashlib
import json
import sys
import time

import bitsandbytes
import torch
import transformers

import glm_common as g


def main() -> int:
    if (g.NF4_DIR / "config.json").exists():
        print(f"cache already exists: {g.NF4_DIR}")
        return 0
    partial = g.NF4_DIR.with_name(g.NF4_DIR.name + ".partial")
    t0 = time.time()
    model, source = g.load_model(prefer_cache=False)
    load_sec = time.time() - t0
    print(f"quantized from {source} in {load_sec:.0f}s", flush=True)

    t1 = time.time()
    model.save_pretrained(partial, max_shard_size="5GB", safe_serialization=True)
    save_sec = time.time() - t1

    manifest = []
    for shard in sorted(partial.glob("*.safetensors")):
        h = hashlib.sha256()
        with open(shard, "rb") as f:
            for block in iter(lambda: f.read(16 << 20), b""):
                h.update(block)
        manifest.append(f"{h.hexdigest()}  {shard.name}")
    (partial / "weights.sha256").write_text("\n".join(manifest) + "\n")
    (partial / "cache_info.json").write_text(json.dumps({
        "source_model_dir": str(g.MODEL_DIR),
        "revision": g.REVISION,
        "precision": g.PRECISION,
        "transformers": transformers.__version__,
        "bitsandbytes": bitsandbytes.__version__,
        "torch": torch.__version__,
        "load_and_quantize_sec": round(load_sec),
        "save_sec": round(save_sec),
        "shards": len(manifest),
    }, indent=2))
    partial.rename(g.NF4_DIR)  # only a complete cache gets the final name
    print(f"saved NF4 cache to {g.NF4_DIR} ({len(manifest)} shards, save {save_sec:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
