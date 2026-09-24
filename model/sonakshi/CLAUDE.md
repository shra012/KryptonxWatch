# KryptonxWatch — Sonakshi: shoplifting detection

## How to work with me
- I run all git commands myself. Write the files, then give me the exact commands. Do not ask me to run smtg and not give me the command. Give commands for everything. and give me explicit instructions. cd ~
- Never ask me for a token, password, or any credential.
- Explain in plain language. Work part by part — never everything at once.
- Test corner cases before handing me code. Tell me what was tested and what wasn't.
- Before anything that affects shared files (repo root, .gitignore, data/, other
  people's folders), tell me what it touches and who it affects, and wait.
- Take corrections directly; fix and move on.

## Where I am
- Team repo: github.com/shra012/KryptonxWatch, cloned at ~/KryptonxWatch
- My work lives ONLY in model/sonakshi/. Never edit teammates' folders.
- Machine: the event's HP ZGX Nano, reached over VPN + SSH as my own user.
- Git over SSH is set up. The key is named "ZGX Nano hackathon" on GitHub —
  it must be deleted from GitHub after Sept 25.

## Team scope
The team is building detections for: robbery, theft, shoplifting, pickpocketing,
guns, queue tracking, and kiosk items not paid for (from model/README.md).
MY piece is SHOPLIFTING only. Kiosk/self-checkout theft overlaps with mine —
ownership not confirmed yet. Don't build for other detections unless I say so.

## Data rules
- Datasets live OUTSIDE every user's home and outside git, in the machine-wide
  shared folder /srv/kryptonx-data/ (owner sonakshi, group `workspace`, setgid,
  default ACL: group rw, everyone read). Teammates read / cp from there.
  Layout: /srv/kryptonx-data/<dataset>/raw/ (downloads as-is), later
  /srv/kryptonx-data/<dataset>/<cleaned>/ for grouped output.
- `workspace` group = shravan, sonakshi, shreyas, vidushi. chaitanya and hp10 are
  not in it (read-only). Users added to the group mid-session must log out/in
  once (or use `sg workspace -c '...'`) before they can write.
- Don't chmod/chgrp inside /srv/kryptonx-data from a session without the
  workspace group — it silently strips the setgid bit.
- NEVER commit video or dataset files. GitHub rejects files over 100 MB, and
  anything committed stays in history for every teammate forever.
- Before downloading anything into data/, confirm data/ is in .gitignore.
  If it isn't, stop and tell me — .gitignore is shared, I'll raise it with Shravan.
- Run `df -h` before any large download.

## Hackathon: Edge AI SJSUHack (SJSU x HP)
- Deadline: Sept 25 2026, 8:00 PM
- Deliverables: public repo with README + setup script, interactive deck with
  architecture diagram, 2-minute demo video with a live demo.
- Judging: 25% each — Innovation, Technical Depth, Impact, Presentation.
- HARD RULE: all AI inference runs on the event's ZGX Nano. No cloud AI APIs for
  core inference. Hybrid allowed only with a clear reason (e.g. escalating a rare,
  uncertain case). Cloud is fine for slides, video and design tools.
- Organizers want: real user problem -> local model -> router -> cloud only when
  needed, PROVEN with measured numbers (e.g. "96% handled locally, alert in 2s,
  0 bytes of video left the store").

## Hardware: HP ZGX Nano G1n
- NVIDIA GB10 Grace Blackwell. aarch64 (ARM, not x86). sm_121, CUDA 13, DGX OS.
- 128 GB unified LPDDR5x memory, shared by CPU and GPU.
- ~273 GB/s memory bandwidth, ~1 PFLOP FP4 (sparse).
- IT IS BIG, NOT FAST. Bandwidth-bound. On the same chip (DGX Spark), GPT-OSS 20B
  decodes ~50 tok/s vs ~205 on an RTX 5090; Llama 70B FP8 ~2.7 tok/s. But Llama 8B
  scaled linearly to batch 32.
- DESIGN FOR: many camera streams in parallel, short outputs per item, several
  models loaded at once. AVOID: one user waiting on a long LLM generation.
- aarch64: some pip packages have no ARM builds. Check before assuming.
  miniforge3 (conda) is installed in my home folder.

## The product
Store owners buy it. "Your cameras already see theft. Nobody is watching them."
- Buyer: mid-size grocery / pharmacy / big-box store (50-150 cameras).
- US retail shrink: $112.1B in 2022, 1.6% of sales (NRF). The "65% from theft"
  figure is employee theft AND shoplifting combined — never cite it as
  shoplifting alone.
- Competitor: Veesion (EUR 53M raised, 5,000+ stores) sells gesture-based theft
  alerts. Our angle: runs entirely on-site, so shopper footage never leaves the store.
- Stretch goal: the same gesture model can report PUT-BACKS (picked up, not
  bought) — a sales insight for the owner, not only loss prevention.

## Evaluation plan — no filming needed
Replay dataset videos into the pipeline as if they were live store cameras
(100 videos = 100 "cameras"). Measure on this box:
- Time to alert vs ground-truth theft start (UCF-Crime test videos have timestamps)
- Latency per stream as the stream count rises from 1 to 100
- % of alerts handled locally by the router; false alarm rate

## Datasets (all verified as accessible)
- UCF-Crime — 1,900 videos, 128 hrs, 13 classes incl. Shoplifting, Stealing,
  Robbery, Burglary. Train = video-level labels; test = temporal annotations.
  https://www.crcv.ucf.edu/research/real-world-anomaly-detection-in-surveillance-videos/
  Zip: https://www.crcv.ucf.edu/data1/chenchen/UCF_Crimes.zip
- MERL Shopping — 106 videos (~2 min each), overhead grocery-store camera, labelled
  reach to shelf / retract from shelf / hand in shelf / inspect product /
  inspect shelf. Free for research; cite the paper.
  https://www.merl.com/research/highlights/merl-shopping-dataset
  FTP: ftp.merl.com/pub/tmarks/MERL_Shopping_Dataset/
- XD-Violence (optional, robbery/escalation) — 4,754 videos, 217 hrs, audio+visual.
  https://roc-ng.github.io/XD-Violence/  (no licence stated on the page)
- AI City Challenge 2022 Track 4, Retail Checkout (optional) — overhead checkout
  video + 116,500 synthetic product images. Click-through licence.
  https://www.aicitychallenge.org/2022-data-and-evaluation/
- DO NOT USE: DukeMTMC-reID (withdrawn by Duke in 2019 over consent and
  surveillance misuse). Market-1501's official site is dead — find a mirror.

## Ethics — say these in the pitch without being asked
- No face recognition, no identity database, no watchlist.
- Uncertain detections go to a human. The system never accuses anyone.
- Analytics are aggregate counts only. Footage never leaves the store.

## Status
- [x] SSH key added to GitHub, repo cloned (~/KryptonxWatch, branch: development)
- [x] Git identity set (name + email) for commits
- [x] .gitignore pushed to development: ignores data/ contents (keeps .md/.yaml/
      .json docs), video files, model weights, archives
- [~] Declare my datasets (UCF-Crime Shoplifting/Stealing, MERL Shopping) in
      docs/data-contract.md — pushed on branch docs/shoplifting-datasets;
      PR to development, Shravan to review
- WORK ON BRANCH docs/shoplifting-datasets until that PR is merged. On
  `development`, model/sonakshi/ doesn't exist yet (files vanish on switch —
  they're safe in the branch).
- [x] Shared data folder /srv/kryptonx-data created and verified
- [x] MERL Shopping downloaded (1.85 GB, zips pass integrity test) and
      unzipped (videos + labels, no __MACOSX junk) ->
      /srv/kryptonx-data/merl-shopping/raw/
- GOTCHA: `unzip` restores the zip's stored file modes (MERL's were 0700 from
  a Mac), which breaks shared perms. After any unzip into /srv/kryptonx-data run
  `sg workspace -c 'chgrp -R workspace X; find X -type d -exec chmod 2775 {} +;
  find X -type f -exec chmod 664 {} +'`, then check
  `find /srv/kryptonx-data ! -group workspace -o ! -perm -o=r`.
- [x] UCF-Crime PARTIAL download DONE 2026-09-24 (Shoplifting 50, Stealing 100,
      Testing_Normal 150, 11 split files, temporal annotations zip; 9.7 GB on
      disk) -> /srv/kryptonx-data/ucf-crime/raw/ via
      model/sonakshi/data_prep/download_ucf_subset.py (18 offline tests pass).
      Verified: all CRCs match on re-run, all 300 videos decode with 0 errors.
      Log: /srv/kryptonx-data/ucf-crime/download.log.
- [x] PR branch docs/shoplifting-datasets updated to /srv/kryptonx-data paths,
      confirmed UCF counts, frame-based labels (commit 9f84b62)
- [x] Committed model/sonakshi/ to docs/shoplifting-datasets (4003ddb)
- [x] UCF index: /srv/kryptonx-data/ucf-crime/index/{videos,events}.csv via
      data_prep/build_ucf_index.py. 300 videos, 32 events, 0 warnings.
- [x] MERL index: /srv/kryptonx-data/merl-shopping/index/{videos,actions}.csv
      via data_prep/build_merl_index.py (needs zgx env for scipy). 106 videos,
      5,377 actions, split 60/18/28 as ReadMe. 2 benign warnings (touching
      intervals in 10_3, 17_3).
- Tests: `~/miniforge3/envs/zgx/bin/python -m unittest discover -s
  model/sonakshi/data_prep/tests` -> 63 pass. Base python3 skips MERL tests.
- UCF facts: temporal annotations are FRAME numbers (sec = frame / fps). All
  300 videos 320x240 @ 30 fps. Up to 2 events per test video; -1 = none.
  21 Shoplifting + 5 Stealing test videos. Shoplifting events 2-90 s long.
- MERL facts: 920x680 @ 30 fps, overhead. Labels are 1-based inclusive frames
  at 30 fps (sec = (start-1)/fps .. end/fps). Split by subject: 1-20 train,
  21-26 val, 27-41 test. No theft in MERL — gestures only.
- [ ] Next: decide model approach, then cut clips / sample frames from the index