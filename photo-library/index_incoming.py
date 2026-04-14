#!/usr/bin/env python3
"""
index_incoming.py — fast local-files indexer for /Volumes/ClawBotLoot/incoming/

Walks every source folder, records (source, path, size, mtime, extension) to a
fresh SQLite DB. No hashing — that's a separate pass (index_incoming_hash.py)
so we can review the inventory before committing CPU/disk time to hashing.

Output: /Volumes/ClawBotLoot/.hub-index/incoming.db

This is a parallel index to the existing files.db (which is cloud-origin and
8 days stale). Do not touch files.db from this script.
"""

import os
import sqlite3
import sys
import time
from pathlib import Path

INCOMING = Path("/Volumes/ClawBotLoot/incoming")
DB_PATH  = Path("/Volumes/ClawBotLoot/.hub-index/incoming.db")
LOG_PATH = Path("/Volumes/ClawBotLoot/.hub-index/incoming_index.log")

PHOTO_EXTS = {
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif",
    ".heic", ".heif", ".webp", ".raw", ".cr2", ".cr3", ".nef",
    ".arw", ".dng", ".orf", ".rw2", ".pef", ".srw", ".raf", ".3fr",
}
VIDEO_EXTS = {
    ".mp4", ".mov", ".avi", ".mkv", ".m4v", ".3gp", ".wmv",
    ".flv", ".webm", ".mts", ".m2ts", ".mpg", ".mpeg",
}
DOC_EXTS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".rtf"}


def log(msg: str):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def setup_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS incoming_files (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            source       TEXT NOT NULL,
            rel_path     TEXT NOT NULL,
            filename     TEXT NOT NULL,
            extension    TEXT,
            size         INTEGER,
            mtime        REAL,
            is_photo     INTEGER DEFAULT 0,
            is_video     INTEGER DEFAULT 0,
            is_doc       INTEGER DEFAULT 0,
            md5          TEXT,
            quick_hash   TEXT,
            UNIQUE(source, rel_path)
        );
        CREATE INDEX IF NOT EXISTS idx_incoming_source ON incoming_files(source);
        CREATE INDEX IF NOT EXISTS idx_incoming_size   ON incoming_files(size);
        CREATE INDEX IF NOT EXISTS idx_incoming_md5    ON incoming_files(md5);
        CREATE INDEX IF NOT EXISTS idx_incoming_qhash  ON incoming_files(quick_hash);
    """)
    conn.commit()
    return conn


def classify(ext: str) -> tuple[int, int, int]:
    ext = ext.lower()
    return (
        1 if ext in PHOTO_EXTS else 0,
        1 if ext in VIDEO_EXTS else 0,
        1 if ext in DOC_EXTS else 0,
    )


def walk_source(source: str, root: Path, conn: sqlite3.Connection) -> dict:
    stats = {"files": 0, "bytes": 0, "photos": 0, "videos": 0, "docs": 0, "other": 0}
    batch = []
    BATCH_SIZE = 1000

    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            if name.startswith("._") or name == ".DS_Store":
                continue
            full = Path(dirpath) / name
            try:
                st = full.stat()
            except OSError:
                continue
            rel = str(full.relative_to(root))
            ext = full.suffix.lower()
            is_p, is_v, is_d = classify(ext)

            batch.append((source, rel, name, ext, st.st_size, st.st_mtime,
                          is_p, is_v, is_d))

            stats["files"] += 1
            stats["bytes"] += st.st_size
            if is_p:   stats["photos"] += 1
            elif is_v: stats["videos"] += 1
            elif is_d: stats["docs"]   += 1
            else:      stats["other"]  += 1

            if len(batch) >= BATCH_SIZE:
                conn.executemany(
                    "INSERT OR REPLACE INTO incoming_files "
                    "(source, rel_path, filename, extension, size, mtime, "
                    " is_photo, is_video, is_doc) VALUES (?,?,?,?,?,?,?,?,?)",
                    batch,
                )
                conn.commit()
                batch.clear()
                log(f"  {source}: {stats['files']:,} files "
                    f"({stats['bytes']/1024/1024/1024:.1f} GB) so far")

    if batch:
        conn.executemany(
            "INSERT OR REPLACE INTO incoming_files "
            "(source, rel_path, filename, extension, size, mtime, "
            " is_photo, is_video, is_doc) VALUES (?,?,?,?,?,?,?,?,?)",
            batch,
        )
        conn.commit()

    return stats


def main():
    log("=" * 60)
    log("index_incoming.py starting")
    log(f"Source root: {INCOMING}")
    log(f"DB: {DB_PATH}")

    if not INCOMING.exists():
        log(f"ERROR: {INCOMING} does not exist")
        sys.exit(1)

    conn = setup_db()

    sources = sorted([p.name for p in INCOMING.iterdir() if p.is_dir()])
    log(f"Found {len(sources)} source folders: {', '.join(sources)}")

    grand_total = {"files": 0, "bytes": 0, "photos": 0, "videos": 0, "docs": 0, "other": 0}
    per_source = {}

    for source in sources:
        root = INCOMING / source
        log(f"\n→ Indexing {source}…")
        t0 = time.time()
        stats = walk_source(source, root, conn)
        dt = time.time() - t0
        per_source[source] = stats
        for k, v in stats.items():
            grand_total[k] += v
        log(f"  {source}: DONE — {stats['files']:,} files "
            f"({stats['bytes']/1024/1024/1024:.1f} GB) in {dt:.0f}s "
            f"[{stats['photos']:,} photos, {stats['videos']:,} videos, "
            f"{stats['docs']:,} docs, {stats['other']:,} other]")

    log("\n" + "=" * 60)
    log("INVENTORY COMPLETE")
    log(f"Total: {grand_total['files']:,} files, "
        f"{grand_total['bytes']/1024/1024/1024:.1f} GB")
    log(f"  Photos: {grand_total['photos']:,}")
    log(f"  Videos: {grand_total['videos']:,}")
    log(f"  Docs:   {grand_total['docs']:,}")
    log(f"  Other:  {grand_total['other']:,}")
    log("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
