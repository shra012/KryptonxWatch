# GLM-4.5-VL

GLM-4.5-VL model-specific assets for KryptonxWatch are grouped here.

- `src/`: GLM inference, training pilot, quantization, and shared GLM helpers.
- `env/glm/`: pinned environment, container, and run launcher.
- `runs/glm45v/`: GLM pilot and quantization outputs.
- `plans/`: GLM deployment and evaluation plan.

Run commands from the KryptonxWatch repository root. For example:

```sh
model/GLM-4.5-VL/env/glm/run.sh glm-g2 python -u model/GLM-4.5-VL/src/glm_pilot.py --windows 20 --out model/GLM-4.5-VL/runs/glm45v/g2-pilot
```
