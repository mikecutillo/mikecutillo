#!/usr/bin/env python3
"""
validate_pair.py — quick-hash-validate name+size dupes between two sources.

Takes a source pair and hashes only the files that participate in (filename,size)
matches between the two sources. Reads sequentially by (source, rel_path) so
the external drive can stream instead of seek.

Usage:
    python3 validate_pair.py cutillo-gphotos cutillo-onedrive

Output:
    - Prints confirmation rate
    - Writes per-group validation status to dupes_report.json (merged in)
"""

import hashlib
import json
import sqlite3
import sys
import time
from pathlib import Path

INCOMING = Path("/Volumes/ClawBotLoot/incoming")
DB_PATH  = Path("/Volumes/ClawBotLoot/.hub-index/incoming.db")
LOG_PATH = Path("/Volumes/ClawBotLoot/.hub-index/incoming_index.log")


def log(msg: str):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def quick_hash(path: str, size: int) -> str | None:
    """Hash of first 64KB + last 64KB + size. ~128KB read per file."""
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


def main():
    if len(sys.argv) != 3:
        print("Usage: validate_pair.py <source_a> <source_b>")
        sys.exit(1)
    source_a, source_b = sys.argv[1], sys.argv[2]

    log("=" * 60)
    log(f"validate_pair.py: {source_a} vs {source_b}")

    conn = sqlite3.connect(str(DB_PATH))

    # Find all files in source_a that have a name+size twin in source_b
    candidates = conn.execute("""
        SELECT id, source, rel_path, filename, size
        FROM incoming_files
        WHERE source IN (?, ?)
          AND (filename, size) IN (
              SELECT a.filename, a.size
              FROM incoming_files a
              JOIN incoming_files b
                ON a.filename=b.filename AND a.size=b.size
              WHERE a.source=? AND b.source=?
          )
        ORDER BY source, rel_path
    """, (source_a, source_b, source_a, source_b)).fetchall()

    total = len(candidates)
    total_bytes = sum(r[4] for r in candidates)
    log(f"Candidates: {total:,} files ({total_bytes/1024/1024/1024:.1f} GB)")

    if not candidates:
        log("No candidates found.")
        return

    hashes_a: dict[tuple, str] = {}  # (filename, size) -> hash
    hashes_b: dict[tuple, str] = {}
    t0 = time.time()
    done = 0
    last_log = 0
    db_batch = []  # (quick_hash, file_id) pairs to write back to DB

    for row in candidates:
        file_id, source, rel_path, filename, size = row
        full = str(INCOMING / source / rel_path)
        qh = quick_hash(full, size)
        if qh is None:
            done += 1
            continue
        key = (filename, size)
        if source == source_a:
            hashes_a[key] = qh
        else:
            hashes_b[key] = qh
        db_batch.append((qh, file_id))
        done += 1

        # Write hashes to DB in batches
        if len(db_batch) >= 1000:
            conn.executemany(
                "UPDATE incoming_files SET quick_hash=? WHERE id=?", db_batch
            )
            conn.commit()
            db_batch.clear()

        if done - last_log >= 500 or done == total:
            rate = done / max(time.time() - t0, 0.001)
            eta = (total - done) / rate if rate > 0 else 0
            log(f"{done:,}/{total:,} ({done/total*100:.1f}%) — {rate:.0f}/s — ETA {eta/60:.1f}min")
            last_log = done

    # Flush remaining hashes to DB
    if db_batch:
        conn.executemany(
            "UPDATE incoming_files SET quick_hash=? WHERE id=?", db_batch
        )
        conn.commit()
        db_batch.clear()
    log(f"Wrote quick_hash values to incoming_files for {done:,} files")

    # Compute match rate
    common_keys = set(hashes_a.keys()) & set(hashes_b.keys())
    matched = sum(1 for k in common_keys if hashes_a[k] == hashes_b[k])
    mismatched = len(common_keys) - matched
    only_a = len(hashes_a) - len(common_keys & set(hashes_a.keys()))
    only_b = len(hashes_b) - len(common_keys & set(hashes_b.keys()))

    total_matched_bytes = sum(k[1] for k in common_keys if hashes_a[k] == hashes_b[k])

    log("=" * 60)
    log(f"RESULTS for {source_a} vs {source_b}:")
    log(f"  Name+size pairs checked:    {len(common_keys):,}")
    log(f"  Confirmed identical:        {matched:,} "
        f"({matched/max(len(common_keys),1)*100:.1f}%)")
    log(f"  Name+size match but hash differs: {mismatched:,} "
        f"(false positives — DO NOT delete)")
    log(f"  Only in {source_a}:            {only_a:,}")
    log(f"  Only in {source_b}:            {only_b:,}")
    log(f"  Confirmed recoverable bytes: {total_matched_bytes/1024/1024/1024:.1f} GB")
    log("=" * 60)

    # Merge into dupes report
    report_path = Path("/Volumes/ClawBotLoot/.hub-index/dupes_report.json")
    if report_path.exists():
        report = json.loads(report_path.read_text())
    else:
        report = {}
    report.setdefault("validations", {})[f"{source_a}__{source_b}"] = {
        "checked_pairs": len(common_keys),
        "confirmed_identical": matched,
        "mismatches_do_not_delete": mismatched,
        "recoverable_gb": round(total_matched_bytes / 1024 / 1024 / 1024, 2),
        "validated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    report_path.write_text(json.dumps(report, indent=2))
    log(f"Updated {report_path}")

    conn.close()


if __name__ == "__main__":
    main()
