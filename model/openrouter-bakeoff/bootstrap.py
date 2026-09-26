"""Is there a clear winner? Paired bootstrap over clips on a bake-off summary.json.

Resamples crime clips and normal clips separately (whole clips, same resample for every model), then reports
each model's Score and Balanced acc. with 95% CIs, the difference to the top model, and how often each model ranks first.

  python3 model/openrouter-bakeoff/bootstrap.py model/openrouter-bakeoff/results-full/summary.json data/bakeoff-full/manifest.json
"""
import json
import random
import sys

B = 10_000
summaries = [s for s in json.load(open(sys.argv[1])) if "single-frame baseline" not in s["model"].lower()]
items = json.load(open(sys.argv[2]))["items"]
crime_ids = [i["id"] for i in items if i["set"] != "normal"]
normals = [i["id"] for i in items if i["set"] == "normal"]


def outcomes(s):
    right = {c["id"]: c["correct"] for c in s["clips"]}
    caught = {c["id"]: c["detected"] for c in s["clips"]}
    alarmed = {n["id"] for n in s["normalFalseAlarms"]}
    return right, caught, alarmed


def main():
    data = {s["model"]: outcomes(s) for s in summaries}
    models = list(data)
    rng = random.Random(0)
    score = {m: [] for m in models}
    bal = {m: [] for m in models}
    first = {m: 0 for m in models}
    for _ in range(B):
        cs = [rng.choice(crime_ids) for _ in crime_ids]
        ns = [rng.choice(normals) for _ in normals]
        best, best_v = None, -1
        for m in models:
            right, caught, alarmed = data[m]
            quiet = sum(n not in alarmed for n in ns) / len(ns)
            sc = (sum(right[c] for c in cs) / len(cs) + quiet) / 2
            score[m].append(sc)
            bal[m].append((sum(caught[c] for c in cs) / len(cs) + quiet) / 2)
            if sc > best_v:
                best, best_v = m, sc
        first[best] += 1
    point = {m: s["score"] for m, s in zip(models, summaries)}
    top = max(models, key=lambda m: point[m])
    ci = lambda xs: (sorted(xs)[int(0.025 * B)], sorted(xs)[int(0.975 * B)])
    print(f"{len(crime_ids)} crime clips, {len(normals)} normal clips, {B} paired bootstrap resamples\n")
    print("| Model | Score [95% CI] | Balanced acc. [95% CI] | Score vs top [95% CI] | Ranked first |")
    print("|---|---|---|---|---|")
    for m in sorted(models, key=lambda m: -point[m]):
        s_lo, s_hi = ci(score[m])
        b_lo, b_hi = ci(bal[m])
        s = next(x for x in summaries if x["model"] == m)
        diff = [a - b for a, b in zip(score[m], score[top])]
        d_lo, d_hi = ci(diff)
        vs = "–" if m == top else f"{100 * (s['score'] - point[top]):+.0f} pts [{100 * d_lo:+.0f}, {100 * d_hi:+.0f}]"
        print(f"| {m} | {s['score']:.0%} [{s_lo:.0%}, {s_hi:.0%}] | {s['balancedAccuracy']:.0%} [{b_lo:.0%}, {b_hi:.0%}] | {vs} | {first[m] / B:.0%} |")


main()
