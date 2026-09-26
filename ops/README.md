# Operations

Run core video inference on the HP ZGX Nano / NVIDIA GB10. The web app, model server, YOLO service, and optional Hermes agent are separate processes; starting the dashboard does not start the others.

## Before a large workload

The team's GB10 has approximately 121 GiB of unified memory shared by CPU and GPU, and other users share the machine. Check it before starting training or model serving:

```bash
free -h
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
sg zrt -c 'zrt services'
```

Coordinate with the owner of an active workload. Run one large training or serving job at a time. Small auxiliary services still consume resources. Do not stop another user's job to make room.

## Services

| Service | Default address | Management |
| --- | --- | --- |
| Next.js app | `http://localhost:3000` | `cd webapp && npm run dev` |
| HP Z Runtime model proxy | `http://127.0.0.1:8080/v1` | `sg zrt -c 'zrt services'` |
| YOLO | `http://127.0.0.1:8090` | [YOLO guide](../model/YOLO/README.md) |
| Legacy scorer bridge | `http://127.0.0.1:8081/v1` | [Qwen3.8 guide](../model/Qwen3.8-27B-INT4/README.md) |
| Hermes | No published container port | [Hermes guide](hermes/README.md) |

Local browser access can use an SSH tunnel when the machine is remote:

```bash
ssh -L 3000:localhost:3000 USER@GB10_HOST
```

Then open `http://localhost:3000`. This also gives the browser the localhost context needed for webcam access. Replace the placeholder user and host with your own connection details.

## Model identity and restart

Sentinel Machines v1 uses the deployed fine-tuned Qwen3-VL-30B-A3B checkpoint. Record the service's checkpoint and adapter configuration before stopping it; the repository does not yet contain a complete v1 restart manifest. Do not replace it with a public base-model command and label the resulting service v1.

Check an existing service without sending a model request:

```bash
sg zrt -c 'zrt services'
curl --fail http://127.0.0.1:8080/v1/models
```

Runtime logs are under `/opt/hp/zrt/run/`; model cache files are under `/opt/hp/zrt/models`. To stop the team's Qwen service when your work is finished and its users have agreed:

```bash
sg zrt -c 'zrt stop qwen3-vl-30b-a3b'
```

The historical public FP8 base-model benchmark used about 55 GB including KV cache. That observation is not a guaranteed v1 memory requirement.

## Data and secrets

Shared datasets and weights live in `/srv/kryptonx-data/`, with write access managed by the `workspace` group. Keep ownership and group permissions intact. Working clips, generated frames, reviews, and watch logs live under the ignored `data/` directory.

Store app secrets in `webapp/.env.local`. Never print or commit those values. Use [.env.local.example](../webapp/.env.local.example) as the variable reference. Hermes keeps private state in `~/.hermes-kryptonx` by default.

## Optional integrations

YOLO refines boxes locally and falls back to the VLM's boxes when unavailable. Hermes uses a hosted text model by default to produce scheduled briefings. Owner alerts use Twilio or SendGrid when explicitly configured. Review these data flows in the [architecture guide](../docs/architecture/README.md).

Background processes may need restarting after a reboot. Use your normal service manager or detached job setup for long runs, and verify service health instead of relying on a dated status note.
