#!/usr/bin/env python3
"""
find_dupes.py — tiered duplicate finder for /Volumes/ClawBotLoot/incoming/

Reads incoming.db and finds duplicates in three tiers:

  Tier 1: filename + size identical (no I/O — metadata only)
          → catches Google Takeout copies, true duplicates with same name
  Tier 2: size identical (no I/O — metadata only)
          → catches renamed duplicates; candidates for hash validation
  Tier 3: quick_hash matches among size-collision groups
          → quick_hash = md5(first 64KB + last 64KB + size)
          → nearly zero false positives, reads only 128KB per file
          → only runs on files that already matched by size

Output:
  - Writes stats to STATUS.md and incoming_index.log
  - Writes dupe groups to /Volumes/ClawBotLoot/.hub-index/dupes_report.json
  - Never deletes anything

Usage:
  python3 find_dupes.py           # full pipeline
  python3 find_dupes.py --tier 1  # just name+size
  python3 find_dupes.py --tier 2  # through size groups
  python3 find_dupes.py --tier 3  # through quick_hash (default)
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

INCOMING = Path("/Volumes/ClawBotLoot/incoming")
DB_PATH  = Path("/Volumes/ClawBotLoot/.hub-index/incoming.db")
LOG_PATH = Path("/Volumes/ClawBotLoot/.hub-index/incoming_index.log")
REPORT   = Path("/Volumes/ClawBotLoot/.hub-index/dupes_report.json")

# Source priority: earlier = keep this copy, later = mark as duplicate
SOURCE_PRIORITY = [
    "cutillo-icloud",
    "icloud-erin",
    "clara-icloud",
    "liam-icloud",
    "cutillo-google",
    "erincutillo-google",
    "erinrameyallen-google",
    "cutillo-onedrive",
    "cutillo-gphotos",
    "erincutillo-gphotos",
    "erinrameyallen-gphotos",
]


def log(msg: str):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def tier_1_name_size(conn: sqlite3.Connection) -> dict:
    """Files with identical (filename, size) — almost certainly duplicates.

    Returns full breakdown with per-group member lists and keep/delete recs,
    grouped by (source_pair) to make review batchable.
    """
    log("Tier 1: scanning for (filename, size) collisions…")
    groups = conn.execute("""
        SELECT filename, size, COUNT(*) AS cnt
        FROM incoming_files
        WHERE size > 0
        GROUP BY filename, size
        HAVING cnt > 1
        ORDER BY cnt DESC, size DESC
    """).fetchall()
    log(f"Tier 1: {len(groups):,} (name,size) groups with duplicates")
    total_waste = 0
    priority = {s: i for i, s in enumerate(SOURCE_PRIORITY)}

    # Per-source-pair summary: how many dupes exist between each pair of sources
    pair_summary: dict[tuple, dict] = defaultdict(lambda: {"count": 0, "bytes": 0})
    # Top individual groups
    top_groups: list[dict] = []

    for filename, size, cnt in groups:
        total_waste += (cnt - 1) * size
        members = conn.execute("""
            SELECT source, rel_path FROM incoming_files
            WHERE filename=? AND size=?
        """, (filename, size)).fetchall()
        sorted_members = sorted(members, key=lambda m: priority.get(m[0], 99))
        keep = sorted_members[0]
        deletes = sorted_members[1:]

        # Tally per-source-pair
        sources_involved = tuple(sorted(set(m[0] for m in members)))
        pair_summary[sources_involved]["count"] += len(deletes)
        pair_summary[sources_involved]["bytes"] += len(deletes) * size

        if len(top_groups) < 200:
            top_groups.append({
                "filename": filename,
                "size": size,
                "count": cnt,
                "waste_bytes": (cnt - 1) * size,
                "keep": {"source": keep[0], "path": keep[1]},
                "delete_candidates": [
                    {"source": d[0], "path": d[1]} for d in deletes
                ],
            })

    log(f"Tier 1: ~{total_waste/1024/1024/1024:.1f} GB total recoverable "
        f"across {len(groups):,} groups")
    log(f"Tier 1: {len(pair_summary)} distinct source-combinations involved")

    # Format pair_summary for report
    pair_list = []
    for sources, stats in sorted(pair_summary.items(),
                                  key=lambda x: -x[1]["bytes"]):
        pair_list.append({
            "sources": list(sources),
            "dupe_files": stats["count"],
            "recoverable_gb": round(stats["bytes"] / 1024 / 1024 / 1024, 2),
        })
        log(f"  {' + '.join(sources)}: "
            f"{stats['count']:,} dupes, "
            f"{stats['bytes']/1024/1024/1024:.1f} GB")

    return {
        "total_groups": len(groups),
        "total_recoverable_gb": round(total_waste / 1024 / 1024 / 1024, 2),
        "source_combinations": pair_list,
        "top_200_groups": top_groups,
    }


def tier_2_size_only(conn: sqlite3.Connection) -> dict:
    """Files grouped by size (catches renamed dupes). Returns counts."""
    log("Tier 2: scanning size-only collisions (will pick candidates for Tier 3)…")
    rows = conn.execute("""
        SELECT size, COUNT(*) AS cnt
        FROM incoming_files
        WHERE size > 1048576  -- > 1 MB, skip tiny files to reduce noise
        GROUP BY size
        HAVING cnt > 1
    """).fetchall()
    log(f"Tier 2: {len(rows):,} distinct sizes with 2+ files (>1MB)")
    total_candidates = sum(r[1] for r in rows)
    log(f"Tier 2: {total_candidates:,} total files in size-collision groups")
    return {"groups": len(rows), "candidates": total_candidates}


def compute_quick_hash(path: str, size: int) -> str | None:
    """md5 of first 64KB + last 64KB + size — fast fingerprint."""
    CHUNK = 65536
    try:
        h = hashlib.md5()
        h.update(str(size).encode())
        with open(path, "rb") as f:
            h.update(f.read(CHUNK))
            if size > CHUNK * 2:
                f.seek(-CHUNK, 2)
                h.update(f.read(CHUNK))
        return h.hexdigest()
    except OSError:
        return None


def tier_3_quick_hash(conn: sqlite3.Connection) -> list[dict]:
    """Quick-hash files that share a size with at least one other file."""
    log("Tier 3: computing quick hashes for size-collision candidates…")

    # Get list of files to hash (unhashed + in size-collision group)
    rows = conn.execute("""
        SELECT id, source, rel_path, size FROM incoming_files
        WHERE quick_hash IS NULL
          AND size > 1048576
          AND size IN (
              SELECT size FROM incoming_files
              WHERE size > 1048576
              GROUP BY size HAVING COUNT(*) > 1
          )
        ORDER BY size DESC
    """).fetchall()

    total = len(rows)
    log(f"Tier 3: {total:,} files to quick-hash "
        f"({sum(r[3] for r in rows)/1024/1024/1024:.1f} GB, "
        f"but only reading 128KB per file)")

    if total == 0:
        return []

    done = 0
    t0 = time.time()
    batch = []
    BATCH_SIZE = 500

    for row in rows:
        file_id, source, rel_path, size = row
        full = str(INCOMING / source / rel_path)
        qh = compute_quick_hash(full, size)
        if qh:
            batch.append((qh, file_id))
        done += 1

        if len(batch) >= BATCH_SIZE:
            conn.executemany(
                "UPDATE incoming_files SET quick_hash=? WHERE id=?", batch
            )
            conn.commit()
            batch.clear()
            rate = done / (time.time() - t0)
            eta = (total - done) / rate if rate > 0 else 0
            log(f"Tier 3: {done:,}/{total:,} ({done/total*100:.1f}%) "
                f"— {rate:.0f}/s — ETA {eta/60:.1f}min")

    if batch:
        conn.executemany(
            "UPDATE incoming_files SET quick_hash=? WHERE id=?", batch
        )
        conn.commit()

    log(f"Tier 3: quick-hashing done in {(time.time()-t0)/60:.1f}min")

    # Now find quick_hash groups with > 1 member
    dupe_groups = conn.execute("""
        SELECT quick_hash, COUNT(*) AS cnt, SUM(size) AS total_bytes
        FROM incoming_files
        WHERE quick_hash IS NOT NULL
        GROUP BY quick_hash
        HAVING cnt > 1
        ORDER BY total_bytes DESC
    """).fetchall()
    log(f"Tier 3: {len(dupe_groups):,} quick_hash dupe groups found")

    if dupe_groups:
        wastable = sum(r[2] - r[2]/r[1] for r in dupe_groups)
        log(f"Tier 3: ~{wastable/1024/1024/1024:.1f} GB recoverable")

    # Build report with top 50 groups
    report = []
    for qh, cnt, total_bytes in dupe_groups[:50]:
        members = conn.execute("""
            SELECT source, rel_path, size FROM incoming_files
            WHERE quick_hash=? ORDER BY source
        """, (qh,)).fetchall()
        priority = {s: i for i, s in enumerate(SOURCE_PRIORITY)}
        sorted_members = sorted(members, key=lambda m: priority.get(m[0], 99))
        keep = sorted_members[0]
        report.append({
            "quick_hash": qh,
            "count": cnt,
            "size_per_file": members[0][2],
            "total_bytes": total_bytes,
            "keep": {"source": keep[0], "path": keep[1]},
            "delete_candidates": [
                {"source": m[0], "path": m[1]} for m in sorted_members[1:]
            ],
        })
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tier", type=int, default=3, choices=[1, 2, 3])
    args = parser.parse_args()

    conn = sqlite3.connect(str(DB_PATH))
    log("=" * 60)
    log(f"find_dupes.py starting (tier 1..{args.tier})")

    total_files = conn.execute("SELECT COUNT(*) FROM incoming_files").fetchone()[0]
    total_bytes = conn.execute("SELECT SUM(size) FROM incoming_files").fetchone()[0] or 0
    log(f"Inventory: {total_files:,} files, {total_bytes/1024/1024/1024:.1f} GB")

    result = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_files": total_files,
        "total_gb": round(total_bytes/1024/1024/1024, 1),
    }

    if args.tier >= 1:
        result["tier_1_name_size"] = tier_1_name_size(conn)
    if args.tier >= 2:
        result["tier_2_size_only"] = tier_2_size_only(conn)
    if args.tier >= 3:
        result["tier_3_quick_hash"] = tier_3_quick_hash(conn)

    REPORT.write_text(json.dumps(result, indent=2))
    log(f"Report written to {REPORT}")
    log("=" * 60)
    conn.close()


if __name__ == "__main__":
    main()
