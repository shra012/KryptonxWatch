# Model evaluation

This directory compares historical vision-language models using the same prompt, parser, and merge logic as the Sentinel Machines application. The benchmark is implemented in [webapp/scripts/vlm-benchmark.ts](../../webapp/scripts/vlm-benchmark.ts).

These are **historical base-model comparisons**, not evaluation results for the fine-tuned Sentinel Machines v1 release. The earlier Qwen3.8 adapter has its own [study results](../Qwen3.8-27B-INT4/runs/qwen38/exp3/README.md).

## Cohorts and artifacts

| Cohort | Scope | Saved summary |
| --- | --- | --- |
| v1 | 36 clips: 12 HawkWatch examples, 6 timed UCF test clips, 18 normal clips | [v1 results](results/README.md) · [JSON](results/summary.json) |
| v2 | 65 clips: 35 crime clips cut around annotated events and 30 normal clips | [v2 results](results-v2/README.md) · [JSON](results-v2/summary.json) |
| full | Larger in-scope UCF test-video benchmark | [Full results](results-full/README.md) · [JSON](results-full/summary.json) |

The JSON summaries preserve exact scores. Per-window raw replies are stored beside them when present; footage and extracted frames belong under ignored `data/bakeoff/` paths.

## Method

The default pipeline submits four frames per eight-second window, uses the app's incident categories, and applies a confidence threshold of 0.5. Consecutive incidents of the same category merge into events.

| Metric | Meaning |
| --- | --- |
| Score | Mean of correct crime-category detection on crime clips and no-alarm rate on normal clips |
| Balanced accuracy | Mean of any-alarm rate on crime clips and no-alarm rate on normal clips |
| Right crime | Crime clips on which the expected category was returned |
| Normal false alarms | Normal clips containing at least one alarm |
| Timed hits | Annotated events matched by the predicted timeline |
| Window AUROC | Ranking quality over labeled windows |

A category-free HawkWatch comparison treats any alarm as a catch, so its Score is not directly equivalent to category-aware Score. Compare its balanced accuracy instead.

## Historical findings

On v1, the local Qwen3-VL-30B-A3B FP8 baseline recorded 69% Score, 81% balanced accuracy, 61% right-crime identification, and false alarms on 22% of normal clips. Gemini 2.5 Flash recorded 75%, 81%, 83%, and 33%, respectively. These local baseline observations were recorded in the project's previous experiment notes.

On the v2 OpenRouter comparison, Qwen3-VL-30B-A3B recorded approximately 80% Score, Nemotron approximately 81%, and Gemini approximately 69%. The cohort is centered around known crime times and should not be treated as an unselected live-camera deployment. See the saved tables for all models and metrics.

Small cohorts produce uncertain rankings. Avoid inferring deployment accuracy, fine-tuning gains, or camera capacity from these point estimates. Retain per-video outputs and use confidence intervals that resample whole videos.

## Reproduce

From the repository root, prepare the selected dataset. This step downloads footage:

```bash
python3 model/openrouter-bakeoff/fetch_data.py --version v2
```

Then, with the web app dependencies installed:

```bash
cd webapp
npx --no-install jiti scripts/vlm-benchmark.ts frames --dataset v2
npx --no-install jiti scripts/vlm-benchmark.ts score --dataset v2
```

The scorer reads saved outputs; it does not call a model. `jiti` must already be available in the environment, and frame extraction needs `ffmpeg`. Do not invoke the TypeScript script directly with the host's Node 18.

To collect new outputs, configure `VLM_BASE_URL`, the model credentials if needed, and use the **actual served model name**:

```bash
npx --no-install jiti scripts/vlm-benchmark.ts run \
  --dataset v2 --models qwen3-vl-30b-a3b --concurrency 4
```

This command performs inference and can incur provider charges when pointed at a hosted endpoint. Record the exact checkpoint, dataset, runtime, frame settings, threshold, and command with the run. The script generates local `summary.md` reports as well as JSON; generated Markdown reports are ignored, while curated `README.md` snapshots remain versioned.

## Boxes and test hygiene

Use [YOLO's visual review tools](../YOLO/README.md) to assess the right actor and timestamp. Box overlap with Gemini is not ground truth: its boxes often describe regions, whereas YOLO boxes describe people.

Do not train on these cohorts or the locked study test set. Human-written annotations and reviewed training labels are the intended supervision; hosted comparator replies are evaluation artifacts, not training targets.
