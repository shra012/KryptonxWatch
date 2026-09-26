# KryptonxWatch: agent handoff (read this first)

Shared context for coding agents (Codex, Claude Code) working in this repo. Last updated 2026-09-26 by shravan's Claude Code session. The human-facing overview is [README.md](README.md); finished and superseded plans live in [docs/archive/](docs/archive/). Folder-specific rules: [webapp/AGENTS.md](webapp/AGENTS.md) (same as `webapp/CLAUDE.md`) and [model/sonakshi/CLAUDE.md](model/sonakshi/CLAUDE.md) (Sonakshi's own working rules).

## What this is
A HawkWatch-style ([Treehacks2025](https://github.com/Grace-Shao/Treehacks2025)) security-video app for retail: upload or live video → a vision-language model (VLM) finds suspected incidents (shoplifting, robbery, fighting, …) with times, scene log and boxes → a person reviews them. **Everything must run on one HP ZGX Nano / NVIDIA GB10.** Team: shravan, sonakshi, shreyas, vidushi, chaitanya.

| Path | What |
|---|---|
| `webapp/` | Next.js 15 dashboard. Models behind `app/api/*` (OpenRouter or local GB10) |
| `model/<Model>/` | Per-model work: `env/`, `src/`, `plans/`, `runs/` (e.g. `Qwen3.8-27B-INT4/`, `GLM-4.5-VL/`, `YOLO/`) |
| `model/.plans/` | Cross-model plans: `local-vlm-quality.md` (**active**) |
| `docs/archive/` | Finished, skipped and superseded plans (web app and model) |
| `ops/hermes/` | Hermes watch agent: setup, stop, skill |
| `model/openrouter-bakeoff/` | Model bake-off (36 UCF clips, the app's pipeline). Raw replies in `results/*.jsonl` |
| `model/study/v1/` | Shoplifting study cohort: splits, leak audit, **hand-marked theft times** (`train_shoplifting_events.csv`) |
| `docs/data-contract.md` | Model ↔ web app detection JSON contract |
| `data/` | Git-ignored local data (e.g. `data/bakeoff/` test clips and frames, `data/bakeoff/review/` review pages) |

## Machine (GB10), read before running anything heavy
- aarch64, GPU sm_121, **121 GiB of memory shared by CPU and GPU (no separate VRAM)**, CUDA 13, 2.7 TB free on `/`.
- **Shared with other users.** Chaitanya often runs `finetune.py` on the GPU. Run **one large job at a time** (a served model *or* training), and stop services when done. Check with `free -h` and `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv`.
- Groups: `docker`, `zrt`, `workspace` (shared `/srv`). If your shell predates a group change, prefix commands with `sg <group> -c '…'`.
- The system Node is **v18**. Run `.ts` scripts with `npx --no-install jiti <file.ts>` (not `node file.ts`).
- **cuDNN gotcha:** in the NGC 26.03 image, cuDNN 9.20 makes conv models (YOLO) silently return nothing on sm_121. Set `torch.backends.cudnn.enabled = False` (then correct at about 10 ms/image).
- The machine rebooted on 2026-09-25. Background jobs do not survive reboots; detach long jobs with `setsid nohup …`.

## Data: `/srv/kryptonx-data` (group `workspace`)
| Path | Contents |
|---|---|
| `ucf-crime/raw/UCF_Crimes/Videos/` | All 13 crime classes (Abuse, Arrest, Arson, Assault, Burglary, Explosion, Fighting, RoadAccidents, Robbery, Shooting, Shoplifting, Stealing, Vandalism), test Normal 150 and Training Normal 800 |
| `ucf-crime/download-2026-09-25.log` | **Download finished** (all classes plus 800 training normals, verified). To re-fetch: `python3 model/Qwen3.8-27B-INT4/src/fetch_ucf.py --classes <…> --out /srv/kryptonx-data/ucf-crime/raw` (skips finished files; HTTP range requests plus a CRC check). Note `ucf-crime/index/*.csv` does not list the newer classes yet |
| `uca/` | **UCA** (UCF-Crime Annotation, CVPR 2024): 1,854 videos, about 23.5k human-written timestamped sentences (train/val/test). **Licence: academic and research use only** (`uca/SOURCE.txt`) |
| `merl-shopping/` | 106 normal-shopping videos (hard negatives), subject-disjoint split |
| `models/yolo/` | YOLO11n/m weights (`weights.sha256`) |
| `models/qwen3.8-27b-shoplifting-lora/<rev>/` | The team's shoplifting LoRA (3 seeds). The app uses seed 2 |
| `models/glm-4.5v/` | GLM-4.5V bf16 (201 GB). **Arm skipped**; deletable if space is needed |

## Models and serving (HP Z Runtime, `zrt` = vLLM 0.26 wrapper)
- Cache: `/opt/hp/zrt/models`. Proxy: `http://127.0.0.1:8080/v1` (OpenAI-compatible). Status: `sg zrt -c 'zrt services'`. Logs: `/opt/hp/zrt/run/vllm-<label>.log`.
- **Current state (2026-09-26): Qwen3-VL-30B-A3B is served** (label `qwen3-vl-30b-a3b`, about 55 GB) for demo filming. Stop it when done: `sg zrt -c 'zrt stop qwen3-vl-30b-a3b'`.
- **YOLO person boxes:** container `kryptonx-yolo` (`kryptonx/yolo:dev`, YOLO11m) on `127.0.0.1:8090`; `YOLO_BASE_URL` in `webapp/.env.local` points at it. Run as the calling user with `-e USER -e LOGNAME` set, or PyTorch fails its user lookup. Stop: `sg docker -c 'docker rm -f kryptonx-yolo'`.
- **Qwen3-VL-30B-A3B-Instruct-FP8** (current best local model, about 55 GB with KV cache, starts in about 3 min):
  `sg zrt -c 'zrt serve hf:Qwen/Qwen3-VL-30B-A3B-Instruct-FP8@d9748a51ae66 --label qwen3-vl-30b-a3b --gpu-memory-fraction 0.45 -- --max-model-len 16384 --limit-mm-per-prompt '"'"'{"image":8,"video":1}'"'"''`
- **Qwen3.8-27B + shoplifting LoRA** (yes/no scorer): see [docs/archive/model-plans/qwen-lora-zrt.md](docs/archive/model-plans/qwen-lora-zrt.md) (not in the current architecture). zrt's proxy **only routes its service label, not LoRA names**. Expose vLLM's socket with the localhost bridge in that runbook (`socat` on 127.0.0.1:8081); re-create it after reboots.
- Containers: `kryptonx/glm:dev` (NGC vLLM 26.03 + PEFT/bitsandbytes, `model/GLM-4.5-VL/env/glm/`; run helper `run.sh`) and `kryptonx/yolo:dev` (+ Ultralytics, `model/YOLO/env/`). Run as the calling user with group `workspace` (see `run.sh`) so outputs are not root-owned.

## Web app
- `cd webapp && npm run dev` → http://localhost:3000 (binds all interfaces). **Running** (detached dev server). Lint and typecheck: `npm run lint && npm run typecheck`.
- `webapp/.env.local` (git-ignored; never print values) sets `VLM_BASE_URL`, `VLM_API_KEY`, `VLM_MODEL`, `VLM_MODEL_OPTIONS` (OpenRouter) and the local modes:
  - `LOCAL_VLM_BASE_URL=http://127.0.0.1:8080/v1`, `LOCAL_VLM_MODELS=qwen3-vl-30b-a3b` → dropdown `local-vlm:<name>`: full JSON analysis like OpenRouter (scene log, categories, boxes, assistant).
  - `LOCAL_SCORER_BASE_URL=http://127.0.0.1:8081/v1`, `LOCAL_SCORER_MODELS=shoplifting-s2` → `local:<name>`: yes/no shoplifting scorer (16 frames at 2 fps per 8 s clip), recorded video only, no boxes.
  - Code: `lib/server/vlm-config.ts`, `lib/vlm/scorer.ts`, `lib/server/frames-to-video.ts`, `app/api/analyze|model|chat|summary`.
- Opened by IP over plain HTTP (e.g. `http://10.36.35.170:3000`), the browser is not a secure context: no `crypto.randomUUID` (use `lib/id.ts`) and no webcam (use `localhost` via a port forward). `next.config.ts` `allowedDevOrigins` lists the team's Tailscale IPs.

## Hermes watch agent (running)
- Plan: [webapp/.plans/hermes-watch-agent.md](webapp/.plans/hermes-watch-agent.md). [Hermes Agent](https://hermes-agent.nousresearch.com) in Docker container `kryptonx-hermes` (state in `~/.hermes-kryptonx`, 2 GB RAM and 1 CPU cap, no GPU, no published ports). Runs a 5-minute update and an hourly digest; the briefing shows on `/overview`.
- Model: `qwen/qwen3.8-flash` on OpenRouter (key copied from `VLM_API_KEY`). Qwen3-VL-30B wrote tool calls as plain text under Hermes, so it is not used for the agent.
- Start or refresh: `ops/hermes/setup.sh` (safe to re-run). Stop: `ops/hermes/stop.sh`. Run now: `sg docker -c 'docker exec kryptonx-hermes hermes cron run kryptonx-watch-update'`.
- Web app side: `WATCH_AGENT_TOKEN` in `webapp/.env.local` turns on the feed log (`data/watch/*.jsonl`) and the MCP endpoint `/api/mcp` the agent reads. Without it nothing is logged.

## Active work: [model/.plans/local-vlm-quality.md](model/.plans/local-vlm-quality.md)
Goal: a local model as good as `google/gemini-2.5-flash` on detection, scene log and boxes, with **Gemini only as a benchmark, never as a teacher** (fine-tune on human-written UCA plus theft times; Google's terms restrict training on Gemini outputs).

Results so far (36 clips; differences under about 10 points are noise):

| | Score | Balanced acc. | Right crime | Normal clips false-alarmed | Timed hits |
|---|---|---|---|---|---|
| Gemini 2.5 Flash | 75% | 81% | 83% | 33% | 5/6 |
| **Qwen3-VL-30B-A3B FP8, local** | 69% | 81% | 61% | 22% | 3/6 |
| Qwen3.8-27B | 64% | 69% | 28% | 0% | 1/6 |

- Phase 2: 8 frames per window gave no Score gain (window AUROC 0.60 → 0.72), so the defaults are kept. Clips are 320×240, so resolution is already native.
- Phase 3: YOLO snapping built (`model/YOLO/src/yolo_snap.py`; review page `model/YOLO/src/box_review.py` → `data/bakeoff/review/boxes.html`, context strips in `context/`). **Automatic box agreement with Gemini is invalid** (Gemini draws region boxes), so boxes are judged by human review.
  - 12-card review (Claude's calls, user confirmed #11): green (local + YOLO) best 5, red 1, blue 1, none 4, unclear 1.
  - Failure modes: key frame chosen before the actor appears (box on the victim), wrong person in crowds, YOLO taking statues/cars as people, false alarms on normal clips.
- Metrics: M1 detection (`jiti scripts/vlm-benchmark.ts score`), M2 human-rated right-person boxes, M3 scene-log similarity to UCA human sentences (to build), M4 blind human review, M5 speed.
- Benchmark options: `--frames-per-window --frame-step --max-width --tag`, `VLM_EXTRA_BODY`, and the `boxes` command.

### Open next steps
1. Tighten YOLO snapping: snap only if the person's confidence is ≥ 0.5 **and** the boxes overlap (drop the "nearest person" fallback). Regenerate the review page.
2. Better actor boxes: pick the key frame after seeing the whole window, and/or "describe the person → ground that description" with Qwen3-VL. Later, ByteTrack.
3. Phase 4 (can start now): reconcile the UCA, UCF and study splits; exclude bake-off v1/v2 videos, the study's locked test cohort, UCA val/test and leak-audit neighbours; build JSON targets from UCA sentences plus incident labels. Human-review the `claude-proposed` theft times.
4. Phase 5: LoRA on bf16 `Qwen/Qwen3-VL-30B-A3B-Instruct` (62 GB, not downloaded yet). Phase 6: final comparison on bake-off **v2** + UCA test (about $0.5 of Gemini calls, **ask first**).
5. Pending user decisions: confirm the box ratings; Nemotron-Omni test (recommendation: skip); whether to delete GLM-4.5V weights.

## Other plans (status)
- `model/Qwen3.8-27B-INT4/plans/shoplifting-study.md`: Exp 3/4 done. The LoRA's ΔAUROC vs zero-shot is not conclusive (+0.027, CI includes 0), with about 3× the false positives per hour.
- `webapp/.plans/hermes-watch-agent.md`: built and running.
- Archived in `docs/archive/`: GLM-4.5V arm (**skipped**), Nemotron fine-tune and serving plans (superseded by Qwen3-VL), Qwen3.8 arm and bake-off plans, the LoRA scorer runbook, and the finished web app plans (HawkWatch parity, model integration, roadmap, YOLO boxes, dashboard refresh).

## Conventions
- **Plans:** discuss and plan first on big work. Save approved plans as markdown (Context, ordered steps, Verification, status line): web app → `webapp/.plans/`, model → `model/<Model>/plans/` (cross-model → `model/.plans/`). Keep status lines current.
- **Git:** never add AI co-author or "Generated with …" lines to commits or PRs. Don't commit data, weights or `.env*.local` (root `.gitignore` covers `data/*`, weights and videos).
- **Test hygiene:** bake-off clips and the study's test cohort are test data. Tune only by cross-validation or on validation; never train on them.
- **Honesty in the product:** detections are "suspected" until a person reviews them. Simulated samples are labelled as such.
- **Shared resources:** say what shared files, folders or GPU memory a change touches before doing it. Never read or print credentials.
