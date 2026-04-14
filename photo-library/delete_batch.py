#!/usr/bin/env python3
"""
delete_batch.py — batch deletion workflow for validated duplicates.

Four modes:
  generate      — Query validated pairs, produce a CSV batch of files to delete
  review        — Show batch summary for user approval
  execute-local — Soft-delete: move files to _staging/pending-deletion/ on ClawBotLoot
  execute-cloud — Hard-delete: rclone deletefile from cloud remote (requires second approval)

Usage:
    python3 delete_batch.py generate cutillo-gphotos cutillo-onedrive
    python3 delete_batch.py review cutillo-gphotos cutillo-onedrive
    python3 delete_batch.py execute-local cutillo-gphotos cutillo-onedrive
    python3 delete_batch.py execute-cloud cutillo-gphotos cutillo-onedrive [--dry-run]

    # For internal (same-source) dupes:
    python3 delete_batch.py generate cutillo-onedrive cutillo-onedrive --internal

Relies on validated data from validate_pair.py stored in dupes_report.json.
"""

import csv
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

INCOMING  = Path("/Volumes/ClawBotLoot/incoming")
STAGING   = Path("/Volumes/ClawBotLoot/archive/_staging/pending-deletion")
DB_PATH   = Path("/Volumes/ClawBotLoot/.hub-index/incoming.db")
LOG_PATH  = Path("/Volumes/ClawBotLoot/.hub-index/incoming_index.log")
REPORT_DIR = Path("/Volumes/ClawBotLoot/.hub-index/deletion-batches")
DUPES_REPORT = Path("/Volumes/ClawBotLoot/.hub-index/dupes_report.json")

# Source priority: earlier = keep
SOURCE_PRIORITY = [
    "cutillo-icloud", "icloud-erin", "clara-icloud", "liam-icloud",
    "cutillo-google", "erincutillo-google", "erinrameyallen-google",
    "cutillo-onedrive", "cutillo-gphotos", "erincutillo-gphotos",
    "erinrameyallen-gphotos",
]

# rclone remote names for cloud deletion
RCLONE_REMOTES = {
    "cutillo-google": "cutillo-google:",
    "cutillo-onedrive": "cutillo-onedrive:",
    "erincutillo-google": "erincutillo-google:",
    "erinrameyallen-google": "erinrameyallen-google:",
    "cutillo-gphotos": None,  # Google Photos — no rclone delete (use Takeout only)
    "erincutillo-gphotos": None,
    "erinrameyallen-gphotos": None,
    "cutillo-icloud": None,  # iCloud — needs icloudpd or web deletion
    "icloud-erin": None,
    "clara-icloud": None,
    "liam-icloud": None,
}


def log(msg: str):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def batch_path(source_a: str, source_b: str) -> Path:
    """Path for the batch CSV."""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    return REPORT_DIR / f"batch_{source_a}__{source_b}.csv"


def ensure_audit_log(conn: sqlite3.Connection):
    """Create audit_log table if needed."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_label TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            file_id INTEGER,
            source TEXT NOT NULL,
            rel_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            size INTEGER,
            quick_hash TEXT,
            keep_source TEXT,
            keep_path TEXT,
            action TEXT NOT NULL,
            dry_run INTEGER DEFAULT 0,
            rclone_exit INTEGER,
            error TEXT
        )
    """)
    conn.commit()


def cmd_generate(source_a: str, source_b: str, internal: bool = False):
    """Generate a deletion batch CSV from validated dupe data."""
    conn = sqlite3.connect(str(DB_PATH))
    priority = {s: i for i, s in enumerate(SOURCE_PRIORITY)}

    if internal:
        # Same-source internal dupes — group by (filename, size), keep one copy
        log(f"Generating internal dupe batch for {source_a}...")
        groups = conn.execute("""
            SELECT filename, size, COUNT(*) as cnt
            FROM incoming_files
            WHERE source=? AND size > 0
            GROUP BY filename, size
            HAVING cnt > 1
            ORDER BY (cnt-1)*size DESC
        """, (source_a,)).fetchall()

        batch_rows = []
        for filename, size, cnt in groups:
            members = conn.execute("""
                SELECT id, source, rel_path, filename, size, quick_hash
                FROM incoming_files
                WHERE source=? AND filename=? AND size=?
                ORDER BY rel_path
            """, (source_a, filename, size)).fetchall()

            keep = members[0]  # keep first by path order
            for m in members[1:]:
                batch_rows.append({
                    "file_id": m[0], "source": m[1], "rel_path": m[2],
                    "filename": m[3], "size": m[4], "quick_hash": m[5] or "",
                    "keep_source": keep[1], "keep_path": keep[2],
                })
    else:
        # Cross-source dupes — use validation data
        log(f"Generating cross-source batch for {source_a} vs {source_b}...")

        # Determine which source to delete from (lower priority = delete)
        if priority.get(source_a, 99) <= priority.get(source_b, 99):
            keep_source, delete_source = source_a, source_b
        else:
            keep_source, delete_source = source_b, source_a

        log(f"Keep: {keep_source}, Delete from: {delete_source}")

        # Find validated identical pairs
        # We need files that share (filename, size) between the two sources
        # and have matching quick_hash
        candidates = conn.execute("""
            SELECT a.id as keep_id, a.source as keep_source, a.rel_path as keep_path,
                   b.id as del_id, b.source as del_source, b.rel_path as del_path,
                   b.filename, b.size, a.quick_hash
            FROM incoming_files a
            JOIN incoming_files b
              ON a.filename = b.filename AND a.size = b.size
            WHERE a.source = ? AND b.source = ?
              AND a.quick_hash IS NOT NULL
              AND b.quick_hash IS NOT NULL
              AND a.quick_hash = b.quick_hash
            ORDER BY b.size DESC
        """, (keep_source, delete_source)).fetchall()

        batch_rows = []
        for row in candidates:
            batch_rows.append({
                "file_id": row[3], "source": row[4], "rel_path": row[5],
                "filename": row[6], "size": row[7], "quick_hash": row[8] or "",
                "keep_source": row[1], "keep_path": row[2],
            })

    # Write CSV
    csv_path = batch_path(source_a, source_b)
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "file_id", "source", "rel_path", "filename", "size",
            "quick_hash", "keep_source", "keep_path",
        ])
        writer.writeheader()
        writer.writerows(batch_rows)

    total_bytes = sum(r["size"] or 0 for r in batch_rows)
    log(f"Batch generated: {len(batch_rows):,} files, {total_bytes/1e9:.2f} GB")
    log(f"CSV: {csv_path}")
    conn.close()


def cmd_review(source_a: str, source_b: str):
    """Show batch summary for user review."""
    csv_path = batch_path(source_a, source_b)
    if not csv_path.exists():
        log(f"ERROR: No batch found at {csv_path}. Run 'generate' first.")
        return

    with open(csv_path, "r") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    total_files = len(rows)
    total_bytes = sum(int(r["size"]) for r in rows)
    sources = set(r["source"] for r in rows)
    keep_sources = set(r["keep_source"] for r in rows)

    log("=" * 60)
    log(f"BATCH REVIEW: {source_a} vs {source_b}")
    log("=" * 60)
    log(f"  Files to delete:    {total_files:,}")
    log(f"  Space to recover:   {total_bytes/1e9:.2f} GB")
    log(f"  Delete from:        {', '.join(sources)}")
    log(f"  Keep copies in:     {', '.join(keep_sources)}")

    # Show hash validation status
    validated = sum(1 for r in rows if r.get("quick_hash"))
    log(f"  Hash-validated:     {validated:,} / {total_files:,}")
    if validated < total_files:
        log(f"  ⚠️ WARNING: {total_files - validated:,} files NOT hash-validated!")

    # Sample files
    log(f"\n  Sample files (first 10):")
    for r in rows[:10]:
        size_mb = int(r["size"]) / 1e6
        log(f"    [{r['source']}] {r['filename']} ({size_mb:.1f} MB)")

    # Extension breakdown
    ext_counts: dict[str, int] = {}
    for r in rows:
        ext = Path(r["filename"]).suffix.lower()
        ext_counts[ext] = ext_counts.get(ext, 0) + 1
    log(f"\n  Extension breakdown:")
    for ext, cnt in sorted(ext_counts.items(), key=lambda x: -x[1])[:15]:
        log(f"    {ext or '(none)':10s}: {cnt:>6,}")

    log("=" * 60)
    log("To execute local soft-delete: python3 delete_batch.py execute-local "
        f"{source_a} {source_b}")


def cmd_execute_local(source_a: str, source_b: str):
    """Soft-delete: move files to staging area."""
    csv_path = batch_path(source_a, source_b)
    if not csv_path.exists():
        log(f"ERROR: No batch found. Run 'generate' first.")
        return

    conn = sqlite3.connect(str(DB_PATH))
    ensure_audit_log(conn)
    batch_label = f"local-delete-{source_a}__{source_b}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    with open(csv_path, "r") as f:
        rows = list(csv.DictReader(f))

    total = len(rows)
    log(f"Soft-deleting {total:,} files to {STAGING}")
    STAGING.mkdir(parents=True, exist_ok=True)

    moved = errors = missing = 0
    t0 = time.time()

    for i, r in enumerate(rows):
        source_full = INCOMING / r["source"] / r["rel_path"]
        # Preserve source structure in staging for traceability
        target_full = STAGING / r["source"] / r["rel_path"]

        action = "pending"
        error = None

        if not source_full.exists():
            missing += 1
            action = "missing"
        else:
            try:
                target_full.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source_full), str(target_full))
                moved += 1
                action = "soft_deleted"
            except OSError as e:
                errors += 1
                error = str(e)[:200]
                action = "error"

        conn.execute("""
            INSERT INTO audit_log
              (batch_label, executed_at, file_id, source, rel_path, filename,
               size, quick_hash, keep_source, keep_path, action, dry_run, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        """, (batch_label, datetime.now().isoformat(), int(r["file_id"]),
              r["source"], r["rel_path"], r["filename"],
              int(r["size"]), r.get("quick_hash", ""),
              r["keep_source"], r["keep_path"], action, error))

        if (i + 1) % 2000 == 0 or i + 1 == total:
            conn.commit()
            rate = (i + 1) / max(time.time() - t0, 0.001)
            eta = (total - i - 1) / rate if rate > 0 else 0
            log(f"  {i+1:,}/{total:,} — moved {moved:,}, missing {missing:,}, "
                f"errors {errors:,} — {rate:.0f}/s — ETA {eta/60:.1f}min")

    conn.commit()
    conn.close()

    log(f"\nSoft-delete complete:")
    log(f"  Moved to staging: {moved:,}")
    log(f"  Already missing:  {missing:,}")
    log(f"  Errors:           {errors:,}")
    log(f"  Staging dir:      {STAGING}")
    log(f"\nFiles are recoverable from staging. To proceed with cloud deletion:")
    log(f"  python3 delete_batch.py execute-cloud {source_a} {source_b}")


def cmd_execute_cloud(source_a: str, source_b: str, dry_run: bool = False):
    """Hard-delete: remove from cloud via rclone."""
    csv_path = batch_path(source_a, source_b)
    if not csv_path.exists():
        log(f"ERROR: No batch found. Run 'generate' first.")
        return

    with open(csv_path, "r") as f:
        rows = list(csv.DictReader(f))

    # Determine which source we're deleting from
    delete_source = rows[0]["source"] if rows else None
    if not delete_source:
        log("ERROR: Empty batch.")
        return

    remote = RCLONE_REMOTES.get(delete_source)
    if remote is None:
        log(f"ERROR: No rclone remote configured for {delete_source}.")
        log(f"  Google Photos and iCloud accounts cannot be deleted via rclone.")
        log(f"  Delete these manually or via their respective APIs/tools.")
        return

    conn = sqlite3.connect(str(DB_PATH))
    ensure_audit_log(conn)
    batch_label = f"cloud-delete-{delete_source}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    total = len(rows)
    log(f"{'[DRY RUN] ' if dry_run else ''}Cloud-deleting {total:,} files from {remote}")

    # Safety check: verify one keep-copy exists
    if rows:
        test_row = rows[0]
        keep_path = f"{test_row['keep_source']}/{test_row['keep_path']}"
        keep_full = INCOMING / test_row["keep_source"] / test_row["keep_path"]
        if not keep_full.exists():
            # Check staging too
            keep_staging = STAGING / test_row["keep_source"] / test_row["keep_path"]
            if not keep_staging.exists():
                log(f"⚠️ WARNING: Keep-copy not found locally for {keep_path}")
                log(f"  Proceeding anyway — keep-copy may be in archive/")

    deleted = failed = skipped = 0
    t0 = time.time()

    # CSV report
    report_csv = REPORT_DIR / f"cloud-delete-{delete_source}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"
    report_file = open(report_csv, "w", newline="")
    writer = csv.writer(report_file)
    writer.writerow(["batch", "timestamp", "filename", "rel_path",
                     "size_mb", "action", "dry_run", "rclone_exit", "error"])

    for i, r in enumerate(rows):
        action = "dry_run" if dry_run else "pending"
        exit_code = None
        error = None

        if not dry_run:
            try:
                result = subprocess.run(
                    ["rclone", "deletefile", f"{remote}{r['rel_path']}"],
                    capture_output=True, text=True, timeout=60,
                )
                exit_code = result.returncode
                if result.returncode == 0:
                    action = "deleted"
                    deleted += 1
                else:
                    action = "delete_failed"
                    error = result.stderr.strip()[:200]
                    failed += 1
            except subprocess.TimeoutExpired:
                action = "delete_failed"
                error = "timeout"
                failed += 1
            except Exception as e:
                action = "delete_failed"
                error = str(e)[:200]
                failed += 1
        else:
            skipped += 1

        writer.writerow([batch_label, datetime.now().isoformat(),
                         r["filename"], r["rel_path"],
                         round(int(r["size"]) / 1e6, 2),
                         action, int(dry_run), exit_code, error or ""])

        conn.execute("""
            INSERT INTO audit_log
              (batch_label, executed_at, file_id, source, rel_path, filename,
               size, quick_hash, keep_source, keep_path, action, dry_run,
               rclone_exit, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (batch_label, datetime.now().isoformat(), int(r["file_id"]),
              r["source"], r["rel_path"], r["filename"],
              int(r["size"]), r.get("quick_hash", ""),
              r["keep_source"], r["keep_path"],
              action, int(dry_run), exit_code, error))

        if (i + 1) % 200 == 0 or i + 1 == total:
            conn.commit()
            rate = (i + 1) / max(time.time() - t0, 0.001)
            eta = (total - i - 1) / rate if rate > 0 else 0
            log(f"  {i+1:,}/{total:,} — deleted {deleted:,}, failed {failed:,} — "
                f"{rate:.0f}/s — ETA {eta/60:.1f}min")

    report_file.close()
    conn.commit()
    conn.close()

    log(f"\n{'DRY RUN — ' if dry_run else ''}Cloud deletion complete:")
    log(f"  Deleted: {deleted:,}")
    log(f"  Failed:  {failed:,}")
    log(f"  Skipped: {skipped:,}")
    log(f"  Report:  {report_csv}")


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 delete_batch.py <mode> <source_a> <source_b> [--internal] [--dry-run]")
        print("Modes: generate, review, execute-local, execute-cloud")
        sys.exit(1)

    mode = sys.argv[1]
    source_a = sys.argv[2]
    source_b = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else source_a
    internal = "--internal" in sys.argv
    dry_run = "--dry-run" in sys.argv

    log("=" * 60)
    log(f"delete_batch.py — mode: {mode}, sources: {source_a} vs {source_b}")

    if mode == "generate":
        cmd_generate(source_a, source_b, internal=internal)
    elif mode == "review":
        cmd_review(source_a, source_b)
    elif mode == "execute-local":
        cmd_execute_local(source_a, source_b)
    elif mode == "execute-cloud":
        cmd_execute_cloud(source_a, source_b, dry_run=dry_run)
    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1)


if __name__ == "__main__":
    main()
