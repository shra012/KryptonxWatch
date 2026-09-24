#!/usr/bin/env bash
# Multiple-instance LoRA training of Qwen3.8-27B (Experiment 3, weak supervision).
# Each round: pick the top-K windows of every train-split Shoplifting video under the current model
# (round 1 uses the zero-shot scores) plus random Normal negatives, train one epoch continuing the
# previous adapter, then score train Shoplifting + validation videos with the new adapter.
#
#   model/src/run_mil.sh <lr> <seed> <rounds>
#   e.g. model/src/run_mil.sh 1e-4 1 3   -> /data/runs/qwen38/exp3/lr1e-4/seed1/round{1,2,3}/
set -euo pipefail

LR=$1 SEED=$2 ROUNDS=$3
K=${K:-3} NEG_RATIO=${NEG_RATIO:-5}
SRC=$(cd "$(dirname "$0")" && pwd)
STUDY=$SRC/../study/v1
PY=${PY:-$HOME/.venvs/qwen/bin/python}
ROOT=/data/runs/qwen38/exp3/lr$LR/seed$SEED
export OMP_NUM_THREADS=16
mkdir -p "$ROOT"

# Videos rescored after every round: train Shoplifting (for the next MIL selection) and all validation.
awk -F, '{ sub(/\r$/, "") } NR > 1 && (($2 == "Shoplifting" && $4 == "train") || $4 == "val") {print $1}' "$STUDY/splits.csv" \
  > "$ROOT/rescore_videos.txt"

scores=/data/runs/qwen38/exp2/zeroshot_trainpool.csv
prev=""
for r in $(seq 1 "$ROUNDS"); do
  dir=$ROOT/round$r
  if [[ ! -f $dir/adapter/adapter_config.json ]]; then
    "$PY" "$SRC/mil_round.py" --scores "$scores" --k "$K" --neg-ratio "$NEG_RATIO" \
      --seed "$((SEED * 100 + r))" --out "$dir/windows.csv"
    "$PY" "$SRC/train_lora.py" --windows "$dir/windows.csv" --lr "$LR" --epochs 1 --seed "$((SEED * 100 + r))" \
      ${prev:+--init-adapter "$prev"} --out "$dir"
  fi
  if [[ ! -f $dir/val.json ]]; then
    "$PY" "$SRC/score_windows.py" --splits train --videos "$ROOT/rescore_videos.txt" --adapter "$dir/adapter" \
      --out "$dir/scores.csv"
    "$PY" "$SRC/evaluate.py" val --scores "$dir/scores.csv" --out "$dir/val.json"
  fi
  scores=$dir/scores.csv
  prev=$dir/adapter
done
