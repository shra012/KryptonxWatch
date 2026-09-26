# Local data

This folder holds local working data for development and benchmarking. **The folder's contents are git-ignored** (root `.gitignore` covers `data/*`, except top-level `.md`, `.json` and `.yaml` files), so a fresh clone has only this README. The full datasets live on the GB10 in `/srv/kryptonx-data`; see [model/README.md](../model/README.md#datasets-and-licences).

| Path | What | How to get it |
|---|---|---|
| `bakeoff/` | Bake-off **v1** test set: HawkWatch's 12 UCF-Crime clips (`hawkwatch/`), 6 timed UCF test videos (`timed/`), 18 normal test videos (`normal/`), `manifest.json`, extracted frames (`frames/`) | `python3 model/openrouter-bakeoff/fetch_data.py --hawkwatch <Treehacks2025>/public/videos`, then `npx --no-install jiti scripts/vlm-benchmark.ts frames` in `webapp/` |
| `bakeoff/review/` | Box review page (`boxes.html`) and its context strips (`context/`) | `model/YOLO/src/box_review.py` |
| `bakeoff-v2/` | Bake-off **v2**: 35 crime clips (cut to 64 s starting 16 s before the crime) plus normal UCF test clips, none from v1 | `python3 model/openrouter-bakeoff/fetch_data.py --version v2` |
| `bakeoff-full/` | Every UCF test video the app can name, cut like v2 (not present on every machine) | `python3 model/openrouter-bakeoff/fetch_data.py --version full` |
| `hawkwatch-src/` | The 12 source clips from the [HawkWatch repo](https://github.com/Grace-Shao/Treehacks2025) | Copy from `Treehacks2025/public/videos` |
| `demo-clips/` | 12 UCF-Crime clips shown on the web app's Videos page (override with `DEMO_CLIPS_DIR`) | Shared copy in `/srv/kryptonx-data/demo-clips` |
| `watch/` | Watch-agent feed log: `events.jsonl` and `briefings.jsonl` | Written by the web app only when `WATCH_AGENT_TOKEN` is set in `webapp/.env.local` |

Details on the bake-off sets and how they are scored: [model/openrouter-bakeoff/README.md](../model/openrouter-bakeoff/README.md).

## Rules

- **Test data only.** The bake-off clips are test sets. Never train or tune on them; tune by cross-validation or on validation data.
- **Licences.** The clips come from UCF-Crime, a research dataset. The UCA sentences used for scene-log work are licensed for **academic and research use only** (`/srv/kryptonx-data/uca/SOURCE.txt`), and MERL Shopping for research and educational use. Do not redistribute this data.
- **Never commit** anything from this folder except this README.
