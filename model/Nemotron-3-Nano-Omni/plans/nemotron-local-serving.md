# Serving Nemotron-3-Nano-Omni locally on the GB10

Status: **serving 2026-09-25 08:12** · steps 1–4 done (FP8 in `eugr/spark-vllm@sha256:71519fa1…`, clock cap 1,800 MHz, container `nemotron-omni` on 127.0.0.1:8000; web app `local-vlm:nemotron-omni`) · step 5 (benchmark) next.

## Context
The project needs local inference, and Nemotron-3-Nano-Omni-30B-A3B was the best open model on the team's larger bake-off sets (full: Score 63% vs Qwen3-VL 59% vs Gemini 57%). Served through zrt (vLLM 0.26, NVFP4 checkpoint), it **hard-reset the whole machine twice** (06:55 and 07:07 on 2026-09-25).
- Both times it happened about 3 minutes into vLLM's "Warming up Mamba2 SSD Triton kernels" (Triton autotuning).
- The GPU monitor (`~/kryptonx-logs/gpu-monitor.csv`) showed 0% utilisation, 12 W, 46–49 °C, and **the clock pinned at 2,398 MHz** up to the reset.
- The journal just stops, with no shutdown sequence.
- The 03:15 reset looked the same.

The Spark community vLLM build ([eugr/spark-vllm-docker](https://github.com/eugr/spark-vllm-docker)) lists a known issue: *"Firmware may cause shutdowns under heavy load; lower GPU clock via `nvidia-smi -lgc`"*. Spark users report Nemotron-3-Nano-Omni **FP8** running under that build ([NVIDIA forum](https://forums.developer.nvidia.com/t/nvidia-nemotron-3-nano-omni-30b-a3b-reasoning-fp8/368468)). Qwen3-VL (no Mamba) has run fine through zrt.

## Steps
1. **Downloads** (running, detached):
   - `eugr/spark-vllm:latest` (vLLM main built for sm_121a, Triton 3.6, CUDA 13.0.2). Pin the digest after pulling.
   - `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-FP8@0acd4b1c237e` (35.2 GB) → `/srv/kryptonx-data/models/nemotron-omni-fp8/<sha>/`. Log: `~/kryptonx-logs/nemotron-fp8-download.log`.
2. **Before starting:**
   - Tell the team (the GPU is shared).
   - Check nothing heavy is running.
   - `sync; echo 3 > /proc/sys/vm/drop_caches` (root).
   - **Cap the GPU clock**: `sudo nvidia-smi -lgc 200,1800` (machine-wide; undo with `sudo nvidia-smi -rgc`).
   - Start the GPU monitor.
3. **Serve** in the Spark container on port 8000 (the zrt proxy is not used, since this is not zrt's vLLM):
   `vllm serve /model --served-model-name nemotron-omni --trust-remote-code --reasoning-parser nemotron_v3 --max-model-len 32768 --max-num-seqs 8 --gpu-memory-utilization 0.5 --limit-mm-per-prompt '{"image":8}' --host 127.0.0.1 --port 8000`
   Add `--mamba-cache-mode align` if the build asks for it. Watch the monitor through the Mamba2 warm-up. If the machine resets anyway, **stop and escalate** (HP/NVIDIA firmware); do not retry blind.
4. **Web app:** point `LOCAL_VLM_BASE_URL` at `http://127.0.0.1:8000/v1` for `nemotron-omni` (thinking is already turned off for local models). Test one request through `/api/analyze`.
5. **Benchmark:** the same 36-clip v1 run as Qwen3-VL (thinking off), then v2/full per [local-vlm-quality.md](../../.plans/local-vlm-quality.md).
6. **After:** decide whether to keep the clock cap as the default while Nemotron is served. Report the zrt/vLLM 0.26 hang to HP/NVIDIA.

## Result (2026-09-25)
Starting from a dropped page cache with the GPU clock capped (`nvidia-smi -lgc 200,1800`, holding 1,794 MHz), the model:
- loaded its weights in about 4.5 min (from disk, cache cold);
- **finished the Mamba2 SSD Triton warm-up in 33 s** (it froze the machine twice under zrt / vLLM 0.26 / NVFP4 / 2,398 MHz);
- tuned its FP8 MoE GEMMs (TRT-LLM autotuner), then opened the API about 6 min after start;
- peaked at 43 °C and about 20 W, with no reset.

Web app check: a 4-frame hw-Robbery1 window gave "A person in a dark hoodie leans over a counter, appearing to take items without paying.", Shoplifting 0.80 with a box (the category is wrong: the clip is a robbery), in 3.5 s cold and 2.5 s warm, identical twice.

Run command (container `nemotron-omni`, restart with `docker start nemotron-omni`):
`docker run -d --name nemotron-omni --runtime=nvidia --gpus all --ipc=host --ulimit memlock=-1 --ulimit stack=67108864 -p 127.0.0.1:8000:8000 -v <fp8 dir>:/model:ro -v $HOME/.cache/spark-vllm:/root/.cache --entrypoint vllm eugr/spark-vllm@sha256:71519fa186a59efd4611074a60d537b60c26eb5e9432dba7ae4d71836cc56cfe serve /model --served-model-name nemotron-omni --trust-remote-code --reasoning-parser nemotron_v3 --max-model-len 32768 --max-num-seqs 8 --gpu-memory-utilization 0.5 --limit-mm-per-prompt '{"image":8}' --host 0.0.0.0 --port 8000`

Web app: `LOCAL_VLM_MODELS=nemotron-omni=http://127.0.0.1:8000/v1` (a per-entry URL, new in `lib/server/vlm-config.ts`).

## Verification
- The API answers `/v1/models`, and one 4-frame window returns valid JSON with thinking off.
- It survives the Mamba2 warm-up and a 163-window benchmark with no reset (`uptime`, monitor log).
- The app shows scene log and detections from `local-vlm:nemotron-omni`.
