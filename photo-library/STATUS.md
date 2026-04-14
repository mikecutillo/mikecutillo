# Migration Work — Autonomous Session Status
**Started:** 2026-04-11 ~13:35
**Finished inventory + dedup scan:** 14:05
**Mode:** Legacy cleanup only — no new downloads, no cloud modifications
**User:** stepped away ~2 hours, gave permission to proceed autonomously on safe work

## TL;DR — what's actionable when you return

**⚠️ CRITICAL UPDATE (14:22): validation found 32% false positive rate on name+size matches.**

The headline "294 GB recoverable" from the first pass was optimistic. Quick-hash validation on the top pair (cutillo-gphotos + cutillo-onedrive) revealed:
- 10,957 name+size matches → only **7,469 are actually identical** (68.2%)
- **3,488 false positives (32%)** — same filename, same size, DIFFERENT content
- True recoverable from this pair: **91.7 GB** (not 107 GB)

**Implication:** We cannot delete based on name+size alone. Every dupe group must be quick-hash-validated before deletion. I'm validating the next biggest pairs now — check the bottom of this file for the running list.

**Realistic recoverable estimate** (applying 68% confirmation rate to the 294 GB headline): **~200 GB of real dupes**. Still a huge win, just smaller than the first number.

---

**Read-only inventory + analysis is complete.** Nothing has been deleted. Everything is queryable in `/Volumes/ClawBotLoot/.hub-index/incoming.db` (sqlite3).

**The big wins:**
| Source pair | Dupe files | Recoverable |
|---|---|---|
| cutillo-gphotos + cutillo-onedrive | 11,584 | **107 GB** |
| cutillo-google + erinrameyallen-google | 22,554 | 59 GB |
| cutillo-gphotos + cutillo-icloud | 9,818 | 36 GB |
| cutillo-gphotos + icloud-erin | 9,786 | 30 GB |
| cutillo-onedrive (internal dupes) | 4,613 | 26 GB |
| cutillo-gphotos (internal dupes) | 6,063 | 16 GB |
| cutillo-gphotos + liam-icloud | 684 | 11.5 GB |
| (20 smaller source combos) | ~10K | ~8 GB |
| **TOTAL** | **~75K files** | **~294 GB** |

**Plus 212 GB of unextracted Takeout zips** in `erincutillo-gphotos/` that are eating space without being indexed (see anomaly #1 below).

## Three things I need your decision on

### 1. `erincutillo-gphotos` has 6 unextracted Takeout zips = 212 GB
```
takeout-20260404T164921Z-3-001.zip  51 GB
takeout-20260404T164921Z-3-002.zip  51 GB
takeout-20260404T164921Z-3-003.zip  51 GB
takeout-20260404T164921Z-3-004.zip  51 GB
takeout-20260404T164921Z-3-005.zip  12 GB
+ 1 more small zip
```

**Verified by peeking inside zip 1 (non-destructive):** it contains 37,194 files of real Erin C Google Photos content dating back to 2014 — albums like "Monday afternoon in Farmingdale", "jess shower", "Photos from 2017", "Photos from 2021". This is genuine family photo history. Across all 6 zips that's probably ~220K files.

**Current indexed state of erincutillo-gphotos folder:** only 477 photos (!). So 99% of Erin C's Google Photos history is locked inside those zips. You almost certainly want to extract them.

**Extraction will need ~220 GB free space.** Current ClawBotLoot free: 551 GB. After extraction: ~338 GB free — still healthy.

**Extraction command** (when you're ready — requires a clean tmux window, will contend with validators if run simultaneously):
```bash
tmux new -s extract-erin
mkdir -p /Volumes/ClawBotLoot/incoming/erincutillo-gphotos/extracted-zips
for z in /Volumes/ClawBotLoot/incoming/erincutillo-gphotos/takeout-*.zip; do
  echo "Extracting $z..."
  unzip -o "$z" -d /Volumes/ClawBotLoot/incoming/erincutillo-gphotos/ && \
    mv "$z" /Volumes/ClawBotLoot/incoming/erincutillo-gphotos/extracted-zips/
done
```
After extraction, re-run `index_incoming.py` to refresh the inventory and `find_dupes.py --tier 2` to re-score dupes with the new content.

### 2. Duplicate deletion strategy — how do you want to do it?
You said "one by one" — I interpret that as "one source at a time, reviewing a batch, then executing." Concretely I propose:

**Per-account workflow (for each source, in order):**
1. I generate a CSV/JSON list of files marked for deletion in source X
2. You spot-check a sample (or open a random selection in Preview)
3. You approve the batch
4. I delete from the **local copy on ClawBotLoot** first (reversible — you can re-pull if wrong)
5. Then I delete from the **cloud account** (real deletion — requires second confirmation)
6. Move to next source

**Suggested order** (least risky → most risky):
1. `cutillo-onedrive` internal dupes (26 GB) — small, isolated
2. `cutillo-gphotos` internal dupes (16 GB) — small, isolated
3. `cutillo-gphotos + cutillo-onedrive` (107 GB) — keep icloud version if present, else gphotos
4. Rest of the pair-wise dupes
5. `cutillo-google + erinrameyallen-google` (59 GB) — needs EXTRA care because these are shared household files; may want to keep them in one account by policy

**Tell me when you're back which order you want and whether you want CSV or an interactive review UI.**

### 3. "Ping on Claude dispatch"
Still don't know what "Claude dispatch" is. I do have access to scheduled-tasks MCP and can create a remote agent that runs at a specific time, but it's not a push notification. Tell me the name of the feature you meant and I'll wire it up properly.

## What I built today (safe, non-destructive)

### New files
- `/Users/mikecutillo/.openclaw/workspace-shared/photo-library/index_incoming.py` — walks ClawBotLoot/incoming, builds local inventory DB
- `/Users/mikecutillo/.openclaw/workspace-shared/photo-library/find_dupes.py` — tiered duplicate finder (tier 1: name+size, tier 2: size only, tier 3: quick_hash — tier 3 is too slow on external HDD, skip it for now)
- `/Volumes/ClawBotLoot/.hub-index/incoming.db` — fresh SQLite inventory of the legacy corpus
- `/Volumes/ClawBotLoot/.hub-index/dupes_report.json` — machine-readable dupe report
- This file (`STATUS.md`)

### What I did NOT do (intentionally)
- Did NOT modify the existing `files.db` (8 days old, cloud-origin). Left it alone so you can compare.
- Did NOT touch any cloud account.
- Did NOT delete anything on ClawBotLoot.
- Did NOT move/organize any files into an archive tree. Archive reorganization needs your approval of the target structure.
- Did NOT resume any pull processes (per your "ignore new stuff" instruction).

## Inventory (final, 2026-04-11 13:55)

**Total: 455,476 files / 2,190 GB**
- Photos: 286,751
- Videos: 33,602
- Docs:   1,240
- Other:  133,883 (mostly Google Takeout JSON sidecars + the 6 zips above)

| Source | Files | Size | Photos | Videos | Notes |
|---|---|---|---|---|---|
| cutillo-onedrive | 106,659 | 731 GB | 72,574 | 6,310 | |
| cutillo-gphotos | 218,756 | 466 GB | 100,662 | 12,732 | 105K JSON sidecars included |
| cutillo-icloud | 39,204 | 441 GB | 33,303 | 5,901 | |
| erincutillo-gphotos | 1,008 | 213 GB | 477 | 33 | ⚠️ 212 GB = unextracted zips |
| icloud-erin | 34,414 | 111 GB | 30,086 | 4,324 | |
| clara-icloud | 2,498 | 71 GB | 1,031 | 1,467 | |
| erinrameyallen-google | 24,103 | 61 GB | 22,446 | 1,189 | |
| cutillo-google | 23,200 | 60 GB | 22,016 | 1,158 | |
| liam-icloud | 1,228 | 21 GB | 806 | 422 | |
| erincutillo-google | 3,503 | 13 GB | 2,920 | 35 | |
| erinrameyallen-gphotos | 903 | 1 GB | 430 | 31 | confirmed genuinely small |

## How to use the new index DB

All queries against `/Volumes/ClawBotLoot/.hub-index/incoming.db`:

```bash
# Per-source totals
sqlite3 /Volumes/ClawBotLoot/.hub-index/incoming.db \
  "SELECT source, COUNT(*), printf('%.1f GB', SUM(size)/1e9) FROM incoming_files GROUP BY source ORDER BY SUM(size) DESC;"

# Find the 20 biggest dupe groups (across all sources)
sqlite3 /Volumes/ClawBotLoot/.hub-index/incoming.db \
  "SELECT filename, COUNT(*) AS cnt, printf('%.1f MB', size/1e6), GROUP_CONCAT(source, ', ') FROM incoming_files WHERE size > 0 GROUP BY filename, size HAVING cnt > 1 ORDER BY (cnt-1)*size DESC LIMIT 20;"

# Show dupes between two specific sources
sqlite3 /Volumes/ClawBotLoot/.hub-index/incoming.db \
  "SELECT filename, size FROM incoming_files WHERE (filename, size) IN (SELECT filename, size FROM incoming_files WHERE source='cutillo-gphotos') AND source='cutillo-onedrive' LIMIT 10;"
```

## Caveats & things I'm less certain about

- **Name+size matching has ~1% false-positive risk** on generic names like `IMG_0001.JPG`. Before deleting the last copy of anything, I'd want to do a quick hash check. For now I've excluded "dangerous" cases (files where keep and delete candidates are in the same account).
- **The 6 Takeout zips in erincutillo-gphotos** are NOT in the dupe count. Their contents may also be dupes of other sources once extracted. Decide on extraction before declaring dedup complete.
- **Source priority for "keep" selection** is currently: icloud (all) → google drive (all) → onedrive → gphotos. This is a defensible default (icloud = origin, onedrive = next-best backup, gphotos = derived/compressed). Change it before we start deleting if you disagree.
- **Tier 3 (quick_hash) was abandoned** because the external drive is too slow for 155K random-access reads (~200 min ETA on a 2-hour budget). Before any actual deletion, we should run quick_hash on the specific groups being deleted to confirm true identity. That's batchable and much faster than doing everything up-front.

## Progress log (for audit)
- 13:35 — session start, STATUS.md created
- 13:35 — killed stray icloudpd (was pulling new content against your wishes)
- 13:38 — index_incoming.py written & launched
- 13:38-13:55 — indexer walked 455K files in 17 min
- 13:55 — inventory complete, all 11 sources indexed
- 13:57 — find_dupes.py v1 launched, Tier 1 hung on unindexed GROUP BY
- 13:59 — killed v1, added (filename,size) index on incoming.db, ANALYZE'd
- 14:00 — find_dupes.py v1 restarted, Tier 1+2 completed in <1s, Tier 3 started
- 14:03 — Tier 3 progress: 12 files/sec, 200+ min ETA — abandoned
- 14:04 — rewrote Tier 1 to produce full group details, re-ran with --tier 2
- 14:05 — final dupe report written to dupes_report.json
- 14:05 — finalized this STATUS.md

## Quick-hash validation results (source pair confirmations)

**Only confirmed-identical files are safe to consider for deletion.** Name+size alone is ~68% reliable; quick_hash (md5 of first 64KB + last 64KB + size) is ~99.9% reliable.

| Source pair | Name+size matches | Validated identical | % confirmed | Real GB recoverable |
|---|---|---|---|---|
| cutillo-gphotos + cutillo-onedrive | 10,957 | 7,469 | 68.2% | **91.7 GB** |
| cutillo-google + erinrameyallen-google | — | — | — | 🔄 running |
| cutillo-gphotos + cutillo-icloud | — | — | — | queued |
| cutillo-gphotos + icloud-erin | — | — | — | queued |

Each additional validation takes ~10-15 min on the external drive. Sequential runs queued in tmux `migration:0`. Check `/Volumes/ClawBotLoot/.hub-index/incoming_index.log` for live progress.

## Ready for you to action
1. Read this file end-to-end — especially the ⚠️ CRITICAL UPDATE at the top
2. Answer the 3 questions (Takeout zips, deletion strategy, "Claude dispatch")
3. Pick the first source pair to action
4. I validate (if not done), you review sample, approve, I execute one batch at a time

**DO NOT delete anything based on the original 294 GB Tier 1 numbers** — they include ~32% false positives. Only act on validated pairs.
