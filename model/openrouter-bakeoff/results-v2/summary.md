| Model | Windows | Score @0.5 | CV score (tuned threshold) | Balanced acc. | Clips detected | Right category | Normal clips false-alarmed | False alarms / min | Window AUROC | Timed events hit | Median onset error | p50 latency | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free | 402/407 | 81% | 81% (0.7/0.5) | 87% | 94% | 83% | 20% | 0.39 | 0.81 | 32/42 | 4.0 s | 1.4 s | $0.000 |
| qwen/qwen3-vl-30b-a3b-instruct | 407/407 | 80% | 77% (0.5/0.8) | 87% | 94% | 80% | 20% | 0.44 | 0.75 | 28/42 | 4.0 s | 1.3 s | $0.070 |
| google/gemma-4-31b-it | 407/407 | 73% | 73% (0.5/0.5) | 81% | 63% | 46% | 0% | 0.00 | 0.72 | 21/42 | 3.0 s | 1.8 s | $0.057 |
| google/gemini-2.5-flash | 407/407 | 69% | 83% (0.9/0.9) | 73% | 100% | 91% | 53% | 1.49 | 0.78 | 38/42 | 5.0 s | 1.4 s | $0.263 |
| qwen/qwen3.8-27b | 407/407 | 65% | 55% (0.95/0.5) | 77% | 60% | 37% | 7% | 0.11 | 0.66 | 15/42 | 4.0 s | 1.1 s | $0.108 |
