#!/usr/bin/env bash
# Experiments 3 and 4 end to end, after the G3 pilot: grid -> selection -> seeds -> sealed test -> localisation.
#
#   model/src/run_study.sh            (resumable: finished steps are skipped)
#
# Grid: 2 learning rates x up to 3 MIL rounds with seed 1, validated after every round, so the round count
# (1-3) is picked together with the learning rate by validation mil_nll. The selected setting is rerun with
# seeds 2 and 3. Only then is the test split scored, once per seed, and compared with the sealed zero-shot scores.
set -euo pipefail

LRS=${LRS:-"1e-4 2e-4"} ROUNDS=${ROUNDS:-3}
SRC=$(cd "$(dirname "$0")" && pwd)
PY=${PY:-$HOME/.venvs/qwen/bin/python}
EXP3=/data/runs/qwen38/exp3
ZS=/data/runs/qwen38/exp2
cd "$SRC"

for lr in $LRS; do
  "$SRC/run_mil.sh" "$lr" 1 "$ROUNDS"
done

read -r LR R < <("$PY" select_config.py "$EXP3" --seed 1 --out "$EXP3/selection.json")
echo "selected lr=$LR round=$R"
for seed in 2 3; do
  "$SRC/run_mil.sh" "$LR" "$seed" "$R"
done

# Adapters are frozen from here on. Record their checksums before looking at the test split.
FINAL=$EXP3/final
mkdir -p "$FINAL"
for seed in 1 2 3; do
  sha256sum "$EXP3/lr$LR/seed$seed/round$R/adapter/"*.safetensors
done > "$FINAL/adapters.sha256"

"$PY" localize.py --scores "$ZS/zeroshot_test_SEALED.csv" --threshold-from "$ZS/zeroshot_trainpool.csv" \
  --out "$FINAL/zeroshot_localize.json"
for seed in 1 2 3; do
  run=$EXP3/lr$LR/seed$seed/round$R
  [[ -f $FINAL/test_seed$seed.csv ]] || \
    "$PY" score_windows.py --splits test --adapter "$run/adapter" --out "$FINAL/test_seed$seed.csv"
  "$PY" evaluate.py test --scores "$FINAL/test_seed$seed.csv" --baseline "$ZS/zeroshot_test_SEALED.csv" \
    --threshold-from "$run/scores.csv" --out "$FINAL/test_seed$seed.json"
  "$PY" localize.py --scores "$FINAL/test_seed$seed.csv" --threshold-from "$run/scores.csv" \
    --out "$FINAL/localize_seed$seed.json" --payload "$FINAL/detections_seed$seed.json"
done
"$PY" evaluate.py test --scores "$ZS/zeroshot_test_SEALED.csv" --threshold-from "$ZS/zeroshot_trainpool.csv" \
  --out "$FINAL/test_zeroshot.json"
echo "study complete: $FINAL"
