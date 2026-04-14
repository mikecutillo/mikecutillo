#!/usr/bin/env python3
"""
categorize_content.py — classify all files in incoming.db into content categories.

Adds/updates the content_category column based on file extension and source context.
Categories:
  photo, video, document, presentation, spreadsheet, game_asset,
  metadata_sidecar, archive, executable, audio, database, config, other

Usage:
    python3 categorize_content.py            # categorize all files
    python3 categorize_content.py --report   # just print summary, no DB changes
"""

import argparse
import sqlite3
import time
from pathlib import Path

DB_PATH  = Path("/Volumes/ClawBotLoot/.hub-index/incoming.db")
LOG_PATH = Path("/Volumes/ClawBotLoot/.hub-index/incoming_index.log")

# --- Extension-based classification rules ---

PHOTO_EXTS = {
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif",
    ".heic", ".heif", ".webp", ".raw", ".cr2", ".cr3", ".nef",
    ".arw", ".dng", ".orf", ".rw2", ".pef", ".srw", ".raf", ".3fr",
    ".avif", ".svg", ".ico",
}

VIDEO_EXTS = {
    ".mp4", ".mov", ".avi", ".mkv", ".m4v", ".3gp", ".wmv",
    ".flv", ".webm", ".mts", ".m2ts", ".mpg", ".mpeg", ".ts",
}

PRESENTATION_EXTS = {".pptx", ".ppt", ".potx", ".key", ".odp", ".fppx"}

SPREADSHEET_EXTS = {".xlsx", ".xls", ".csv", ".ods", ".numbers"}

DOCUMENT_EXTS = {
    ".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt",
    ".pages", ".md", ".epub",
}

AUDIO_EXTS = {
    ".mp3", ".aac", ".wav", ".flac", ".m4a", ".ogg", ".wma", ".aiff",
}

GAME_ASSET_EXTS = {
    ".uasset", ".umap", ".uproject", ".uexp",  # Unreal Engine
    ".mcworld", ".mcpack", ".mcaddon", ".mctemplate",  # Minecraft
    ".unity", ".prefab", ".asset",  # Unity
}

ARCHIVE_EXTS = {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".dmg", ".iso"}

EXECUTABLE_EXTS = {".exe", ".msi", ".dll", ".app", ".air", ".apk", ".ipa"}

DATABASE_EXTS = {".db", ".sqlite", ".sqlite3", ".ldb", ".wal", ".shm"}

CONFIG_EXTS = {
    ".ini", ".cfg", ".conf", ".yaml", ".yml", ".toml",
    ".plist", ".xml", ".html", ".htm", ".css", ".js",
    ".log", ".dat", ".download", ".partial",
}

EMAIL_EXTS = {".msg", ".eml", ".oft", ".ofc", ".mbox"}

# Google Takeout gphotos sources — JSON files here are metadata sidecars
GPHOTOS_SOURCES = {"cutillo-gphotos", "erincutillo-gphotos", "erinrameyallen-gphotos"}


def classify(ext: str, source: str, filename: str) -> str:
    """Determine content_category for a file."""
    ext = ext.lower()

    # Special case: JSON in gphotos sources = metadata sidecar
    if ext == ".json" and source in GPHOTOS_SOURCES:
        return "metadata_sidecar"

    # .MP files from Google Takeout = Pixel Motion Photos (MP4 video)
    if ext == ".mp":
        return "video"

    if ext in PHOTO_EXTS:
        return "photo"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in PRESENTATION_EXTS:
        return "presentation"
    if ext in SPREADSHEET_EXTS:
        return "spreadsheet"
    if ext in DOCUMENT_EXTS:
        return "document"
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in GAME_ASSET_EXTS:
        return "game_asset"
    if ext in ARCHIVE_EXTS:
        return "archive"
    if ext in EXECUTABLE_EXTS:
        return "executable"
    if ext in DATABASE_EXTS:
        return "database"
    if ext in CONFIG_EXTS:
        return "config"
    if ext in EMAIL_EXTS:
        return "email"

    # JSON not in gphotos = generic config/data
    if ext == ".json":
        return "config"

    # OneNote packages
    if ext == ".onepkg" or ext == ".one":
        return "document"

    return "other"


def log(msg: str):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def ensure_column(conn: sqlite3.Connection):
    """Add content_category column if it doesn't exist."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(incoming_files)").fetchall()]
    if "content_category" not in cols:
        conn.execute("ALTER TABLE incoming_files ADD COLUMN content_category TEXT")
        conn.commit()
        log("Added content_category column to incoming_files")


def categorize_all(conn: sqlite3.Connection):
    """Classify every file and update the DB."""
    rows = conn.execute(
        "SELECT id, extension, source, filename FROM incoming_files"
    ).fetchall()
    log(f"Categorizing {len(rows):,} files...")

    batch = []
    counts: dict[str, int] = {}
    for file_id, ext, source, filename in rows:
        cat = classify(ext or "", source, filename)
        counts[cat] = counts.get(cat, 0) + 1
        batch.append((cat, file_id))

        if len(batch) >= 5000:
            conn.executemany(
                "UPDATE incoming_files SET content_category=? WHERE id=?", batch
            )
            conn.commit()
            batch.clear()

    if batch:
        conn.executemany(
            "UPDATE incoming_files SET content_category=? WHERE id=?", batch
        )
        conn.commit()

    log("Categorization complete.")
    return counts


def print_report(conn: sqlite3.Connection):
    """Print detailed content report by source x category."""
    log("=" * 70)
    log("CONTENT CATEGORY REPORT")
    log("=" * 70)

    # Global summary
    log("\n--- Global Summary ---")
    rows = conn.execute("""
        SELECT content_category, COUNT(*) as cnt,
               printf('%.2f GB', SUM(size)/1e9) as size
        FROM incoming_files
        GROUP BY content_category
        ORDER BY SUM(size) DESC
    """).fetchall()
    for cat, cnt, size in rows:
        log(f"  {cat or 'UNCATEGORIZED':20s}  {cnt:>8,} files  {size:>10s}")

    # Per-source breakdown
    log("\n--- Per-Source Breakdown ---")
    sources = [r[0] for r in conn.execute(
        "SELECT DISTINCT source FROM incoming_files ORDER BY source"
    ).fetchall()]

    for source in sources:
        log(f"\n  [{source}]")
        rows = conn.execute("""
            SELECT content_category, COUNT(*) as cnt,
                   printf('%.2f GB', SUM(size)/1e9) as size
            FROM incoming_files
            WHERE source=?
            GROUP BY content_category
            ORDER BY SUM(size) DESC
        """, (source,)).fetchall()
        for cat, cnt, size in rows:
            log(f"    {cat or 'UNCATEGORIZED':20s}  {cnt:>8,} files  {size:>10s}")

    # Photos found in non-photo sources (important for reorganization)
    log("\n--- Photos Found in Non-Photo Sources ---")
    rows = conn.execute("""
        SELECT source, COUNT(*) as cnt,
               printf('%.2f GB', SUM(size)/1e9) as size
        FROM incoming_files
        WHERE content_category='photo'
          AND source NOT LIKE '%gphotos%'
          AND source NOT LIKE '%icloud%'
        GROUP BY source
        ORDER BY SUM(size) DESC
    """).fetchall()
    if rows:
        for source, cnt, size in rows:
            log(f"  {source:30s}  {cnt:>8,} photos  {size:>10s}")
    else:
        log("  (none)")

    # Videos in non-video-primary sources
    log("\n--- Videos Found in File/Doc Sources ---")
    rows = conn.execute("""
        SELECT source, COUNT(*) as cnt,
               printf('%.2f GB', SUM(size)/1e9) as size
        FROM incoming_files
        WHERE content_category='video'
          AND source NOT LIKE '%gphotos%'
          AND source NOT LIKE '%icloud%'
        GROUP BY source
        ORDER BY SUM(size) DESC
    """).fetchall()
    if rows:
        for source, cnt, size in rows:
            log(f"  {source:30s}  {cnt:>8,} videos  {size:>10s}")
    else:
        log("  (none)")

    log("\n" + "=" * 70)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", action="store_true",
                        help="Print report only, no DB changes")
    args = parser.parse_args()

    conn = sqlite3.connect(str(DB_PATH))
    log("=" * 60)
    log("categorize_content.py starting")

    if args.report:
        print_report(conn)
    else:
        ensure_column(conn)
        counts = categorize_all(conn)
        log("\nCategory counts:")
        for cat, cnt in sorted(counts.items(), key=lambda x: -x[1]):
            log(f"  {cat:20s}  {cnt:>8,}")
        print_report(conn)

    conn.close()


if __name__ == "__main__":
    main()
