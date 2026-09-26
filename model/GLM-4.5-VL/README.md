# GLM-4.5-VL

**Status: skipped on 2026-09-25.** Gates G0 to G2 passed and G3 to G6 were not run; local work moved to dedicated VL models ([model/.plans/local-vlm-quality.md](../.plans/local-vlm-quality.md)). Plan and history: [docs/archive/model-plans/glm-4.5v-arm.md](../../docs/archive/model-plans/glm-4.5v-arm.md). The bf16 weights remain at `/srv/kryptonx-data/models/glm-4.5v/` (201 GB) until someone deletes them.

GLM-4.5V assets for KryptonxWatch are grouped here. The container in `env/glm/` (`kryptonx/glm:dev`: NGC vLLM 26.03 plus PEFT and bitsandbytes) is the planned container for Phase 5 fine-tuning in that plan.

- `src/`: GLM inference, training pilot, quantization, and shared GLM helpers.
- `env/glm/`: pinned environment, container, and run launcher.
- `runs/glm45v/`: GLM pilot (`g2-pilot`, `g2-pilot-box`) and quantization (`nf4-cache`) outputs.

Run commands from the KryptonxWatch repository root. For example:

```sh
model/GLM-4.5-VL/env/glm/run.sh glm-g2 python -u model/GLM-4.5-VL/src/glm_pilot.py --windows 20 --out model/GLM-4.5-VL/runs/glm45v/g2-pilot
```
