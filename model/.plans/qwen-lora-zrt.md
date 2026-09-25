# Local inference: Qwen3.8-27B shoplifting LoRA on zrt, wired into the web app

Status: running 2026-09-25 · served via zrt + localhost bridge · web app scoring verified end to end.

## Context
The study's Experiment 3 adapter ([shra012/qwen3.8-27b-ucf-shoplifting-lora](https://huggingface.co/shra012/qwen3.8-27b-ucf-shoplifting-lora), revision `82bcfcbe2c`) should run locally on the GB10 through HP Z Runtime (`zrt`, which wraps vLLM 0.26.0), and be selectable in the web app. Per its README, the adapter's ΔAUROC over zero-shot is not conclusive (+0.027, CI includes 0), it produces about 3× the false positives per hour and much longer events. So this is a demo and review aid, not a deployable detector.

## Pinned inputs
| Item | Value |
|---|---|
| Base | `Qwen/Qwen3.8-27B@1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0` (`Qwen3_5ForConditionalGeneration`, 64 layers: 48 linear attention + 16 full; bf16 55.6 GB), in the zrt cache `/opt/hp/zrt/models/hf/Qwen/Qwen3.8-27B/<rev>` |
| Adapter | `/srv/kryptonx-data/models/qwen3.8-27b-shoplifting-lora/82bcfcbe2ca62972aa2af1e6868ab711d54b775f/{seed1,seed2,seed3}`. SHA-256 matches `results/adapters.sha256` |
| Protocol | 8 s windows every 4 s, 16 frames at 2 fps, native resolution, fixed prompt, thinking off, score = P(yes)/(P(yes)+P(no)) of the first answer token (adapter `code/qwen_model.py`) |
| Runtime | zrt 0.30.7 → vLLM 0.26.0, transformers 5.12.1. vLLM maps the adapter's `in_proj_qkv`/`in_proj_z` onto its packed `in_proj_qkvz` |

## Steps
1. Pull the base: `zrt pull hf:Qwen/Qwen3.8-27B@<rev>`.
2. Serve with LoRA:
   `zrt serve hf:Qwen/Qwen3.8-27B@<rev> --label qwen38-shoplifting --gpu-memory-fraction 0.65 -- --enable-lora --max-lora-rank 16 --max-loras 3 --lora-modules shoplifting-s1=<adapter>/seed1 shoplifting-s2=<adapter>/seed2 shoplifting-s3=<adapter>/seed3 --max-model-len 8192 --max-logprobs 20`
3. Smoke test with `model/src/qwen_zrt_score.py` on one UCF test shoplifting clip and one normal clip, for each seed and the base (zero-shot). Check that yes/no mass is at least 0.99 and that scores look plausible.
3b. **Bridge (required):** zrt's proxy on 8080 lists the LoRA names but only routes its service label (`qwen38-shoplifting`), so requests for `shoplifting-s1` fail with "unknown model name". Expose vLLM's socket on localhost instead:
   `sg zrt -c 'setsid nohup socat TCP-LISTEN:8081,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/opt/hp/zrt/run/vllm-qwen38-shoplifting.sock > ~/kryptonx-logs/vllm-bridge.log 2>&1 < /dev/null &'`
   Re-run it after a reboot. It keeps working across zrt service restarts because the socket path stays the same.
4. Web app: `webapp/.env.local` sets `LOCAL_SCORER_BASE_URL=http://127.0.0.1:8081/v1` (the bridge) and `LOCAL_SCORER_MODELS=shoplifting-s1,shoplifting-s2,shoplifting-s3` (add the base's served name for zero-shot). They appear in Preferences as `local:<name>`.
   - `app/api/analyze` packs the 16 frames into a lossless 2 fps MP4 (`lib/server/frames-to-video.ts`) and reads P(yes) (`lib/vlm/scorer.ts`).
   - Recorded video only. Live is blocked for scorers, and the assistant and summary stay on the chat model.
4b. **Local general model (like OpenRouter):** `LOCAL_VLM_MODELS=qwen38-shoplifting` lists the base model (no LoRA; the name is zrt's label) as `local-vlm:qwen38-shoplifting`. It runs the app's normal JSON analysis (scene log, categories, boxes), assistant and summary, with thinking off. Verified: 4-frame window in about 7.4 s, and the assistant answers with timestamp links. The assistant now sends a single system message, because Qwen3.x templates reject a second one.
5. End-to-end: upload a UCF test shoplifting video, pick `local:shoplifting-s1`, run AI analysis, and check the detections on the timeline.

## Results so far (2026-09-25)
- Load: weights 312 s, torch.compile 73 s, full startup about 14 min. Holds about 69 GB (`--gpu-memory-fraction 0.65`) with a 14.8 GiB KV cache.
- Direct (`qwen_zrt_score.py`, lossless clip): Shoplifting001 at 54–62 s, seed 1, P(yes) 0.924, yes/no mass 0.9997.
- Through the app (`/api/analyze`, 16 JPEG frames): same window, P(yes) 0.967, about 1 s per window when warm.

## Known gaps
- **Frame parity:** the browser samples JPEG frames at most 640 px wide, while training used raw decoded frames. Scores will differ slightly from the study's numbers. Parity against the adapter's `score_windows.py` is not yet measured.
- **Threshold:** the app uses 0.5. The README warns that its validation threshold does not transfer (about 90 FP/h on test normals).

## Verification
- `curl 127.0.0.1:8081/v1/models` (the bridge) lists the three LoRA names, and a chat request for `shoplifting-s1` succeeds. The 8080 proxy lists them too but rejects requests for them.
- The smoke test gives yes/no mass ≥ 0.99, and repeated requests give identical scores.
- `npm run lint && npm run typecheck` pass. Analysis of an uploaded video with `local:shoplifting-s1` produces Shoplifting detections labelled with the model name.
