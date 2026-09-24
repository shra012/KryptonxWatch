# Plan: pick one shoplifting model (32 GB each)

Draft · 2026-09-24 · Team of 4–5.

## Goal

Fine-tune 3 models on the same store videos, pick the one that best flags shoplifting and when it happens, and hand that model to the web app. Each job stays under 32 GB on the shared 121 GB machine (two jobs at a time). The winner is chosen on validation. The test set is scored once.

**Slots:** A = 7–8B · B = 12–14B · C = largest that still fits in 32 GB (QLoRA if needed). Drop any model that cannot answer one 8 s clip and finish one LoRA step inside 32 GB.

**People:** 1 data · 2 scorer and comparison table · 3/4/5 one model each. With 4 people, person 2 also runs slot C.

Same 8 s windows, same yes/no question, same metric. Do not tune on the test videos. 3 seeds only after settings are chosen on validation.

## Tasks

1. **Access.** Everyone can read `/srv/kryptonx-data`. Model weights need the `zrt` group.
2. **32 GB check.** Pass or drop each slot.
3. **Freeze data.** Timestamp the 29 training shoplifting videos. Lock the UCF test split. No camera in two splits. Can run beside step 2.
4. **Scorer.** One script, validation AUROC, same result for two people.
5. **Train.** Best prompt and a small learning-rate grid on validation, then 3 seeds.
6. **Pick.** Highest mean validation AUROC. Near-tie: fewer false alarms per hour, then speed. Stop the others.
7. **Test once.** Person 2 scores the winner. No changes first.
8. **Hand off.** One sample event on the web app timeline (`docs/data-contract.md`).

Steps 2 and 3 run together. Step 5 waits for both. Winner = validation AUROC, not the test score.
