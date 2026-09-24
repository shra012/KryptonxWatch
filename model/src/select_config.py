"""Pick the MIL grid configuration (learning rate x round) with the lowest validation mil_nll.

Ties (within 1e-4) go to the smaller learning rate, then the earlier round. Prints "<lr> <round>" and
writes the full table to --out.

  python model/src/select_config.py /data/runs/qwen38/exp3 --seed 1 --out selection.json
"""

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", type=Path)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    table = []
    for val in sorted(args.root.glob(f"lr*/seed{args.seed}/round*/val.json")):
        m = json.loads(val.read_text())
        table.append({"lr": val.parents[2].name[2:], "round": int(val.parent.name[5:]), **m})
    if not table:
        sys.exit(f"no val.json under {args.root}")
    best = min(table, key=lambda r: (round(r["mil_nll"], 4), float(r["lr"]), r["round"]))
    if args.out:
        args.out.write_text(json.dumps({"selected": best, "grid": table}, indent=2))
    print(best["lr"], best["round"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
