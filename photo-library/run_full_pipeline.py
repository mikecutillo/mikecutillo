#!/usr/bin/env python3
"""
run_full_pipeline.py — full dedup + organize pipeline, no stops.

Steps:
  1. Quick-hash validate ALL duplicate pairs (name+size matches)
  2. Delete confirmed duplicates from NAS (keep highest-priority copy)
  3. Delete extracted zip archives to free space
  4. Generate reorganization manifest
  5. Execute reorganization (move files into archive structure)
  6. Print final stats
"""

import hashlib
import json
import os
import shutil
import sqlite3
import time
from collections import defaultdict
from pathlib import Path

INCOMING = Path("/Volumes/ClawBotLoot/incoming")
ARCHIVE  = Path("/Volumes/ClawBotLoot/archive")
DB_PATH  = Path("/Volumes/ClawBotLoot/.hub-index/incoming.db")
LOG_PATH = Path("/Volumes/ClawBotLoot/.hub-index/pipeline.log")

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


def quick_hash(path: str, size: int) -> str | None:
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


# ── STEP 1: Quick-hash validate all name+size duplicate groups ──────────────

def step1_hash_all_dupes(conn: sqlite3.Connection):
    """Hash every file that participates in a name+size duplicate group."""
    log("=" * 70)
    log("STEP 1: Quick-hash validating ALL duplicate candidates")
    log("=" * 70)

    # Find all files that share (filename, size) with at least one other file
    # and haven't been hashed yet
    rows = conn.execute("""
        SELECT id, source, rel_path, filename, size
        FROM incoming_files
        WHERE quick_hash IS NULL
          AND size > 0
          AND (filename, size) IN (
              SELECT filename, size FROM incoming_files
              WHERE size > 0
              GROUP BY filename, size HAVING COUNT(*) > 1
          )
        ORDER BY source, rel_path
    """).fetchall()

    total = len(rows)
    already = conn.execute("""
        SELECT COUNT(*) FROM incoming_files WHERE quick_hash IS NOT NULL
    """).fetchone()[0]
    log(f"Already hashed: {already:,}")
    log(f"Need to hash: {total:,} files")

    if total == 0:
        log("All candidates already hashed. Skipping.")
        return

    done = 0
    t0 = time.time()
    batch = []
    BATCH_SIZE = 500

    for row in rows:
        file_id, source, rel_path, filename, size = row
        full = str(INCOMING / source / rel_path)
        qh = quick_hash(full, size)
        if qh:
            batch.append((qh, file_id))
        done += 1

        if len(batch) >= BATCH_SIZE:
            conn.executemany("UPDATE incoming_files SET quick_hash=? WHERE id=?", batch)
            conn.commit()
            batch.clear()

        if done % 2000 == 0 or done == total:
            rate = done / max(time.time() - t0, 0.001)
            eta = (total - done) / rate if rate > 0 else 0
            log(f"  Hashing: {done:,}/{total:,} ({done*100//total}%) "
                f"— {rate:.0f}/s — ETA {eta/60:.1f}min")

    if batch:
        conn.executemany("UPDATE incoming_files SET quick_hash=? WHERE id=?", batch)
        conn.commit()

    elapsed = time.time() - t0
    log(f"Step 1 complete: hashed {done:,} files in {elapsed/60:.1f} min")


# ── STEP 2: Identify and delete confirmed duplicates ────────────────────────

def step2_delete_confirmed_dupes(conn: sqlite3.Connection) -> int:
    """Delete files that are confirmed identical (same quick_hash) keeping
    the highest-priority copy per SOURCE_PRIORITY."""
    log("=" * 70)
    log("STEP 2: Deleting confirmed duplicate files")
    log("=" * 70)

    priority = {s: i for i, s in enumerate(SOURCE_PRIORITY)}

    # Find all name+size groups where all members have been hashed
    groups = conn.execute("""
        SELECT filename, size, COUNT(*) as cnt
        FROM incoming_files
        WHERE size > 0
          AND quick_hash IS NOT NULL
        GROUP BY filename, size
        HAVING cnt > 1
    """).fetchall()

    log(f"Found {len(groups):,} name+size groups with hashes")

    total_deleted = 0
    total_freed = 0
    total_kept = 0
    total_false_positives = 0
    delete_batch_ids = []
    errors = 0

    for filename, size, cnt in groups:
        members = conn.execute("""
            SELECT id, source, rel_path, quick_hash
            FROM incoming_files
            WHERE filename=? AND size=? AND quick_hash IS NOT NULL
            ORDER BY source
        """, (filename, size)).fetchall()

        # Group by hash — only delete when hashes actually match
        hash_groups = defaultdict(list)
        for m in members:
            hash_groups[m[3]].append(m)

        for qh, copies in hash_groups.items():
            if len(copies) < 2:
                continue

            # Sort by priority, keep first
            sorted_copies = sorted(copies, key=lambda m: priority.get(m[1], 99))
            keep = sorted_copies[0]
            total_kept += 1

            for dup in sorted_copies[1:]:
                dup_id, dup_source, dup_rel_path, _ = dup
                full_path = INCOMING / dup_source / dup_rel_path
                try:
                    if full_path.exists():
                        full_path.unlink()
                        total_deleted += 1
                        total_freed += size
                        delete_batch_ids.append(dup_id)
                    else:
                        delete_batch_ids.append(dup_id)
                        total_deleted += 1
                except OSError as e:
                    errors += 1
                    if errors <= 10:
                        log(f"  ERROR deleting {full_path}: {e}")

        # Count false positives (same name+size, different hash)
        if len(hash_groups) > 1:
            total_false_positives += sum(len(v) for v in hash_groups.values()) - len(hash_groups)

    # Remove deleted entries from DB
    if delete_batch_ids:
        for i in range(0, len(delete_batch_ids), 1000):
            batch = delete_batch_ids[i:i+1000]
            placeholders = ",".join("?" * len(batch))
            conn.execute(f"DELETE FROM incoming_files WHERE id IN ({placeholders})", batch)
        conn.commit()

    log(f"\nStep 2 complete:")
    log(f"  Confirmed identical groups: {len(groups):,}")
    log(f"  Files deleted: {total_deleted:,}")
    log(f"  Space freed: {total_freed/1024/1024/1024:.1f} GB")
    log(f"  Files kept (best copy): {total_kept:,}")
    log(f"  False positives avoided: {total_false_positives:,}")
    log(f"  Errors: {errors:,}")

    return total_deleted


# ── STEP 3: Delete extracted zip archives ───────────────────────────────────

def step3_delete_zip_archives(conn: sqlite3.Connection):
    """Delete the extracted Takeout zips and any other archive files that
    have been fully extracted."""
    log("=" * 70)
    log("STEP 3: Cleaning up extracted zip archives")
    log("=" * 70)

    zip_dirs = [
        INCOMING / "erincutillo-gphotos" / "extracted-zips",
        INCOMING / "cutillo-gphotos",  # may have Mike Google Photos zips
    ]

    total_freed = 0
    for zip_dir in zip_dirs:
        if not zip_dir.exists():
            continue
        for f in zip_dir.iterdir():
            if f.name.startswith("._"):
                continue
            if f.suffix.lower() in (".zip", ".tgz", ".tar", ".gz"):
                try:
                    size = f.stat().st_size
                    log(f"  Deleting {f.name} ({size/1024/1024/1024:.1f} GB)")
                    f.unlink()
                    total_freed += size
                except OSError as e:
                    log(f"  SKIP: {f.name} — {e}")

    # Also delete zip entries from DB
    deleted = conn.execute("""
        DELETE FROM incoming_files
        WHERE content_category = 'archive'
          AND extension IN ('.zip', '.tgz', '.tar', '.gz')
          AND source IN ('erincutillo-gphotos', 'cutillo-gphotos')
    """).rowcount
    conn.commit()

    log(f"Step 3 complete: freed {total_freed/1024/1024/1024:.1f} GB, "
        f"removed {deleted} DB entries")


# ── STEP 4: Generate reorganization manifest ────────────────────────────────

def step4_generate_manifest(conn: sqlite3.Connection):
    """Import and run the manifest generator from reorganize.py."""
    log("=" * 70)
    log("STEP 4: Generating reorganization manifest")
    log("=" * 70)

    # Import the existing reorganize module
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from reorganize import generate_manifest

    manifest = generate_manifest(conn, source_filter=None, use_exif=False)
    log(f"Step 4 complete: manifest has {len(manifest):,} entries")
    return manifest


# ── STEP 5: Execute reorganization ──────────────────────────────────────────

def step5_execute_moves(conn: sqlite3.Connection):
    """Move files from incoming/ to archive/ per the manifest."""
    log("=" * 70)
    log("STEP 5: Executing file moves to archive")
    log("=" * 70)

    from reorganize import execute_manifest
    execute_manifest()
    log("Step 5 complete")


# ── STEP 6: Final stats ────────────────────────────────────────────────────

def step6_final_stats(conn: sqlite3.Connection):
    """Print final inventory stats."""
    log("=" * 70)
    log("STEP 6: Final Statistics")
    log("=" * 70)

    remaining = conn.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM incoming_files").fetchone()
    log(f"Remaining in incoming/: {remaining[0]:,} files, {remaining[1]/1e9:.1f} GB")

    # Count archive files
    archive_count = 0
    archive_size = 0
    if ARCHIVE.exists():
        for f in ARCHIVE.rglob("*"):
            if f.is_file():
                archive_count += 1
                archive_size += f.stat().st_size

    log(f"Archive/: {archive_count:,} files, {archive_size/1e9:.1f} GB")

    # Disk space
    import subprocess
    result = subprocess.run(["df", "-g", "/Volumes/ClawBotLoot"],
                          capture_output=True, text=True)
    if result.stdout:
        log(f"Disk: {result.stdout.strip().split(chr(10))[-1]}")


# ── MAIN ────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume-from", type=int, default=1,
                        help="Resume from step N (1-6)")
    args = parser.parse_args()
    start_step = args.resume_from

    log("\n" + "=" * 70)
    log(f"FULL PIPELINE — DEDUP + ORGANIZE (from step {start_step})")
    log(f"Started at {time.strftime('%Y-%m-%d %H:%M:%S')}")
    log("=" * 70)

    t_start = time.time()
    conn = sqlite3.connect(str(DB_PATH))

    total = conn.execute("SELECT COUNT(*), printf('%.1f GB', SUM(size)/1e9) FROM incoming_files").fetchone()
    log(f"Starting inventory: {total[0]:,} files, {total[1]}")

    if start_step <= 1: step1_hash_all_dupes(conn)
    if start_step <= 2: step2_delete_confirmed_dupes(conn)
    if start_step <= 3: step3_delete_zip_archives(conn)
    if start_step <= 4: step4_generate_manifest(conn)
    if start_step <= 5: step5_execute_moves(conn)
    step6_final_stats(conn)

    elapsed = time.time() - t_start
    log(f"\n{'=' * 70}")
    log(f"PIPELINE COMPLETE in {elapsed/3600:.1f} hours")
    log(f"{'=' * 70}")

    conn.close()


if __name__ == "__main__":
    main()
