#!/usr/bin/env python3
"""
reorganize.py — move files from incoming/ into a clean archive/ structure.

Classifies by content_category (from categorize_content.py), extracts dates
for photos/videos, and generates a manifest before moving anything.

Archive structure:
  /Volumes/ClawBotLoot/archive/
    Photos/YYYY/MM/
    Videos/YYYY/MM/
    Documents/Presentations/
    Documents/Office/
    Documents/PDFs/
    GameAssets/UnrealEngine/
    GameAssets/Minecraft/
    Misc/Screenshots/
    Misc/Google-Takeout-Meta/
    Misc/Unsorted/
    _staging/pending-deletion/

Usage:
    python3 reorganize.py --manifest          # generate manifest (dry run)
    python3 reorganize.py --execute           # execute moves from manifest
    python3 reorganize.py --manifest --source cutillo-icloud  # one source only
    python3 reorganize.py --stats             # show manifest stats without regenerating

Date extraction priority:
  1. EXIF DateTimeOriginal (photos/videos)
  2. Google Takeout JSON sidecar photoTakenTime
  3. Filename pattern (IMG_20210415_123456, PXL_20210415_...)
  4. File mtime
  5. Unsorted (no date)
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

INCOMING = Path("/Volumes/ClawBotLoot/incoming")
ARCHIVE  = Path("/Volumes/ClawBotLoot/archive")
DB_PATH  = Path("/Volumes/ClawBotLoot/.hub-index/incoming.db")
LOG_PATH = Path("/Volumes/ClawBotLoot/.hub-index/incoming_index.log")
MANIFEST = Path("/Volumes/ClawBotLoot/.hub-index/reorganize_manifest.json")

# Regex patterns for date extraction from filenames
FILENAME_DATE_PATTERNS = [
    # IMG_20210415_123456.jpg, PXL_20210415_123456.jpg, VID_20210415_...
    re.compile(r"(?:IMG|PXL|VID|MVIMG|BURST|Screenshot)_(\d{4})(\d{2})(\d{2})"),
    # 2021-04-15 or 2021_04_15
    re.compile(r"(\d{4})[-_](\d{2})[-_](\d{2})"),
    # Photo 2021-04-15
    re.compile(r"Photo[s]?\s+(\d{4})-(\d{2})-(\d{2})"),
]

# Google Takeout gphotos sources with JSON sidecars
GPHOTOS_SOURCES = {"cutillo-gphotos", "erincutillo-gphotos", "erinrameyallen-gphotos"}

# Category → archive subdirectory mapping
CATEGORY_PATHS = {
    "presentation": "Documents/Presentations",
    "spreadsheet":  "Documents/Office",
    "document":     "Documents/Office",
    "game_asset":   None,  # handled specially based on extension
    "metadata_sidecar": "Misc/Google-Takeout-Meta",
    "archive":      "Misc/Archives",
    "executable":   "Misc/Executables",
    "email":        "Misc/Email",
    "database":     "Misc/System",
    "config":       "Misc/System",
    "audio":        "Misc/Audio",
    "other":        "Misc/Unsorted",
}

GAME_ASSET_MAP = {
    ".uasset": "GameAssets/UnrealEngine",
    ".umap":   "GameAssets/UnrealEngine",
    ".uproject": "GameAssets/UnrealEngine",
    ".uexp":   "GameAssets/UnrealEngine",
    ".mcworld": "GameAssets/Minecraft",
    ".mcpack":  "GameAssets/Minecraft",
    ".mcaddon": "GameAssets/Minecraft",
    ".mctemplate": "GameAssets/Minecraft",
}


def log(msg: str):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def extract_date_from_exif_batch(file_paths: list[str]) -> dict[str, tuple[int, int] | None]:
    """Use exiftool to batch-extract DateTimeOriginal. Returns {path: (year, month)}."""
    if not file_paths:
        return {}

    result = {}
    # Process in chunks of 200 to avoid arg-list-too-long and timeouts
    for i in range(0, len(file_paths), 200):
        chunk = file_paths[i:i+200]
        try:
            proc = subprocess.run(
                ["exiftool", "-DateTimeOriginal", "-CreateDate", "-json", "-q"] + chunk,
                capture_output=True, text=True, timeout=600
            )
            if proc.returncode == 0 and proc.stdout.strip():
                entries = json.loads(proc.stdout)
                for entry in entries:
                    path = entry.get("SourceFile", "")
                    date_str = entry.get("DateTimeOriginal") or entry.get("CreateDate")
                    if date_str and date_str != "0000:00:00 00:00:00":
                        try:
                            dt = datetime.strptime(date_str[:10], "%Y:%m:%d")
                            result[path] = (dt.year, dt.month)
                        except ValueError:
                            pass
        except subprocess.TimeoutExpired:
            log(f"  EXIF batch timeout at offset {i} (skipping chunk)")
        except (json.JSONDecodeError, OSError) as e:
            log(f"  EXIF batch error at offset {i}: {e}")

        if (i + 200) % 5000 == 0 or i + 200 >= len(file_paths):
            log(f"  EXIF progress: {min(i+200, len(file_paths)):,}/{len(file_paths):,} "
                f"({len(result):,} dates extracted)")

    return result


def extract_date_from_json_sidecar(source: str, rel_path: str) -> tuple[int, int] | None:
    """Try to read date from Google Takeout JSON sidecar."""
    if source not in GPHOTOS_SOURCES:
        return None

    # Sidecar is typically: photo.jpg → photo.jpg.json or photo.json
    sidecar_candidates = [
        INCOMING / source / (rel_path + ".json"),
        INCOMING / source / (str(Path(rel_path).with_suffix(".json"))),
    ]
    # Google Takeout also uses supplemental-metadata pattern
    base = str(Path(rel_path).stem)
    parent = str(Path(rel_path).parent)
    sidecar_candidates.append(
        INCOMING / source / parent / f"{base}.supplemental-metada.json"
    )

    for sidecar in sidecar_candidates:
        if sidecar.exists():
            try:
                data = json.loads(sidecar.read_text())
                ts = data.get("photoTakenTime", {}).get("timestamp")
                if ts:
                    dt = datetime.fromtimestamp(int(ts))
                    return (dt.year, dt.month)
            except (json.JSONDecodeError, ValueError, OSError):
                pass
    return None


def extract_date_from_filename(filename: str) -> tuple[int, int] | None:
    """Try to parse date from filename patterns."""
    for pattern in FILENAME_DATE_PATTERNS:
        m = pattern.search(filename)
        if m:
            try:
                year, month = int(m.group(1)), int(m.group(2))
                if 1990 <= year <= 2030 and 1 <= month <= 12:
                    return (year, month)
            except (ValueError, IndexError):
                pass
    return None


def extract_date_from_rel_path(rel_path: str) -> tuple[int, int] | None:
    """Try to parse date from directory structure in the relative path.

    Handles patterns like:
      - "2021/04/photo.jpg" (iCloud structure)
      - "Google Photos/Photos from 2021/photo.jpg"
      - "Photos/2021/04/photo.jpg"
    """
    # Pattern: year/month in path segments
    m = re.search(r"/(\d{4})/(\d{2})/", "/" + rel_path)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        if 1990 <= year <= 2030 and 1 <= month <= 12:
            return (year, month)

    # Pattern: "Photos from YYYY"
    m = re.search(r"Photos from (\d{4})", rel_path)
    if m:
        year = int(m.group(1))
        if 1990 <= year <= 2030:
            return (year, 1)  # Month unknown, use January as placeholder

    return None


def extract_date_from_mtime(mtime: float) -> tuple[int, int] | None:
    """Use file modification time as last resort."""
    if mtime and mtime > 0:
        dt = datetime.fromtimestamp(mtime)
        if 1990 <= dt.year <= 2030:
            return (dt.year, dt.month)
    return None


def determine_target(row: dict, date_ym: tuple[int, int] | None) -> str:
    """Determine the archive target path for a file."""
    cat = row["content_category"]
    ext = (row["extension"] or "").lower()
    filename = row["filename"]

    # Photos and videos get date-sorted
    if cat == "photo":
        if date_ym:
            return f"Photos/{date_ym[0]}/{date_ym[1]:02d}/{filename}"
        return f"Misc/Unsorted/Photos/{filename}"

    if cat == "video":
        if date_ym:
            return f"Videos/{date_ym[0]}/{date_ym[1]:02d}/{filename}"
        return f"Misc/Unsorted/Videos/{filename}"

    # Game assets — route by extension
    if cat == "game_asset":
        subdir = GAME_ASSET_MAP.get(ext, "GameAssets/Other")
        # Preserve relative structure within the game project
        rel = row["rel_path"]
        return f"{subdir}/{rel}"

    # PDFs get their own folder
    if cat == "document" and ext == ".pdf":
        return f"Documents/PDFs/{filename}"

    # Everything else uses the category map
    target_dir = CATEGORY_PATHS.get(cat, "Misc/Unsorted")
    return f"{target_dir}/{filename}"


def resolve_collision(target: str, seen: dict[str, str]) -> str:
    """If target path already claimed by a different source file, add a suffix."""
    if target not in seen:
        return target

    base = str(Path(target).with_suffix(""))
    ext = Path(target).suffix
    i = 2
    while True:
        candidate = f"{base}_{i}{ext}"
        if candidate not in seen:
            return candidate
        i += 1


def generate_manifest(conn: sqlite3.Connection, source_filter: str | None = None,
                      use_exif: bool = False):
    """Build the full source→target manifest and write to disk.

    Fast mode (default): uses filename patterns + JSON sidecars + mtime only.
    EXIF mode (--exif): also reads EXIF from files where fast methods fail.
    """
    log("Generating reorganization manifest...")

    where = "WHERE content_category IS NOT NULL"
    params: list = []
    if source_filter:
        where += " AND source=?"
        params.append(source_filter)

    rows = conn.execute(f"""
        SELECT id, source, rel_path, filename, extension, size, mtime,
               content_category
        FROM incoming_files
        {where}
        ORDER BY source, content_category, rel_path
    """, params).fetchall()

    col_names = ["id", "source", "rel_path", "filename", "extension", "size",
                 "mtime", "content_category"]

    log(f"Processing {len(rows):,} files...")

    # Phase 1: Fast date extraction (no disk I/O)
    # Try filename pattern → JSON sidecar → mtime for all media files first
    manifest = []
    seen_targets: dict[str, str] = {}  # target_path → source_key
    stats = {"exif": 0, "sidecar": 0, "filename": 0, "mtime": 0,
             "rel_path": 0, "none": 0}
    cat_stats: dict[str, dict] = {}
    undated_media: list[tuple[int, str]] = []  # (manifest_index, full_path)

    for i, row in enumerate(rows):
        r = dict(zip(col_names, row))
        full_path = str(INCOMING / r["source"] / r["rel_path"])
        source_key = f"{r['source']}/{r['rel_path']}"

        # Date extraction chain (fast methods first)
        date_ym = None
        date_method = "none"

        if r["content_category"] in ("photo", "video"):
            # 1. Filename pattern (instant, no I/O)
            date_ym = extract_date_from_filename(r["filename"])
            if date_ym:
                date_method = "filename"

            # 2. Relative path may contain date folders (e.g. "2021/04/photo.jpg"
            #    or "Google Photos/Photos from 2021/photo.jpg")
            if not date_ym:
                date_ym = extract_date_from_rel_path(r["rel_path"])
                if date_ym:
                    date_method = "rel_path"

            # 3. JSON sidecar (reads small JSON files — fast)
            if not date_ym:
                date_ym = extract_date_from_json_sidecar(r["source"], r["rel_path"])
                if date_ym:
                    date_method = "sidecar"

            # 4. mtime (from DB — no I/O)
            if not date_ym:
                date_ym = extract_date_from_mtime(r["mtime"])
                if date_ym:
                    date_method = "mtime"

            # Track undated for optional EXIF pass
            if not date_ym:
                undated_media.append((len(manifest), full_path))

            stats[date_method] += 1

        target = determine_target(r, date_ym)
        target = resolve_collision(target, seen_targets)
        seen_targets[target] = source_key

        # Track category stats
        cat = r["content_category"]
        if cat not in cat_stats:
            cat_stats[cat] = {"files": 0, "bytes": 0}
        cat_stats[cat]["files"] += 1
        cat_stats[cat]["bytes"] += r["size"] or 0

        manifest.append({
            "id": r["id"],
            "source": r["source"],
            "source_path": r["rel_path"],
            "target_path": target,
            "size": r["size"],
            "category": r["content_category"],
            "date_method": date_method if r["content_category"] in ("photo", "video") else None,
        })

        if (i + 1) % 50000 == 0:
            log(f"  Processed {i+1:,}/{len(rows):,} files...")

    log(f"Fast pass complete. {len(undated_media):,} media files still undated.")

    # Phase 2: Optional EXIF pass for undated files
    if use_exif and undated_media:
        log(f"EXIF extraction for {len(undated_media):,} undated media files...")
        undated_paths = [p for _, p in undated_media]
        exif_dates = extract_date_from_exif_batch(undated_paths)
        log(f"Got EXIF dates for {len(exif_dates):,} files")

        for manifest_idx, full_path in undated_media:
            if full_path in exif_dates:
                date_ym = exif_dates[full_path]
                entry = manifest[manifest_idx]
                entry["date_method"] = "exif"
                # Recompute target with the new date
                r_fake = {
                    "content_category": entry["category"],
                    "extension": Path(entry["source_path"]).suffix.lower(),
                    "filename": Path(entry["source_path"]).name,
                    "rel_path": entry["source_path"],
                }
                new_target = determine_target(r_fake, date_ym)
                new_target = resolve_collision(new_target, seen_targets)
                # Remove old target from seen
                old_target = entry["target_path"]
                seen_targets.pop(old_target, None)
                seen_targets[new_target] = f"{entry['source']}/{entry['source_path']}"
                entry["target_path"] = new_target
                stats["exif"] += 1
                stats["none"] -= 1

    # Write manifest
    MANIFEST.write_text(json.dumps({
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_files": len(manifest),
        "date_extraction_stats": stats,
        "category_stats": {k: {"files": v["files"], "gb": round(v["bytes"]/1e9, 2)}
                           for k, v in sorted(cat_stats.items(), key=lambda x: -x[1]["bytes"])},
        "entries": manifest,
    }, indent=2))

    log(f"\nManifest written: {MANIFEST}")
    log(f"Total entries: {len(manifest):,}")
    log(f"\nDate extraction breakdown (photos + videos):")
    for method, count in sorted(stats.items(), key=lambda x: -x[1]):
        log(f"  {method:12s}: {count:>8,}")
    log(f"\nCategory breakdown:")
    for cat, s in sorted(cat_stats.items(), key=lambda x: -x[1]["bytes"]):
        log(f"  {cat:20s}: {s['files']:>8,} files, {s['bytes']/1e9:>8.2f} GB")

    collisions = sum(1 for t in seen_targets if "_2" in t or "_3" in t)
    log(f"\nFilename collisions resolved: {collisions:,}")

    return manifest


def show_stats():
    """Show manifest stats without regenerating."""
    if not MANIFEST.exists():
        log("No manifest found. Run with --manifest first.")
        return

    data = json.loads(MANIFEST.read_text())
    log(f"Manifest generated: {data['generated_at']}")
    log(f"Total files: {data['total_files']:,}")
    log(f"\nDate extraction stats: {json.dumps(data['date_extraction_stats'], indent=2)}")
    log(f"\nCategory stats:")
    for cat, s in data["category_stats"].items():
        log(f"  {cat:20s}: {s['files']:>8,} files, {s['gb']:>8.2f} GB")

    # Show sample of target paths
    log(f"\nSample target paths:")
    seen_dirs = set()
    for entry in data["entries"]:
        d = str(Path(entry["target_path"]).parent)
        if d not in seen_dirs and len(seen_dirs) < 30:
            seen_dirs.add(d)
            log(f"  {d}/")


def execute_manifest():
    """Execute moves from the manifest file."""
    if not MANIFEST.exists():
        log("ERROR: No manifest found. Run with --manifest first.")
        sys.exit(1)

    data = json.loads(MANIFEST.read_text())
    entries = data["entries"]
    total = len(entries)
    log(f"Executing manifest: {total:,} files to move")

    conn = sqlite3.connect(str(DB_PATH))
    moved = 0
    errors = 0
    t0 = time.time()

    for i, entry in enumerate(entries):
        source_full = INCOMING / entry["source"] / entry["source_path"]
        target_full = ARCHIVE / entry["target_path"]

        try:
            target_full.parent.mkdir(parents=True, exist_ok=True)

            if source_full.exists():
                shutil.move(str(source_full), str(target_full))
                moved += 1
            else:
                errors += 1
                if errors <= 10:
                    log(f"  MISSING: {source_full}")

        except OSError as e:
            errors += 1
            if errors <= 10:
                log(f"  ERROR: {e}")

        if (i + 1) % 5000 == 0 or i + 1 == total:
            rate = (i + 1) / max(time.time() - t0, 0.001)
            eta = (total - i - 1) / rate if rate > 0 else 0
            log(f"  {i+1:,}/{total:,} ({(i+1)/total*100:.1f}%) — "
                f"{rate:.0f}/s — ETA {eta/60:.1f}min — "
                f"moved {moved:,}, errors {errors:,}")

    elapsed = time.time() - t0
    log(f"\nExecution complete in {elapsed/60:.1f} min")
    log(f"  Moved: {moved:,}")
    log(f"  Errors: {errors:,}")
    log(f"  Skipped (missing): {total - moved - errors:,}")

    conn.close()


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--manifest", action="store_true",
                       help="Generate manifest (dry run)")
    group.add_argument("--execute", action="store_true",
                       help="Execute moves from manifest")
    group.add_argument("--stats", action="store_true",
                       help="Show manifest stats")
    parser.add_argument("--source", type=str, default=None,
                        help="Filter to one source (e.g., cutillo-icloud)")
    parser.add_argument("--exif", action="store_true",
                        help="Also read EXIF from undated files (slow, requires disk I/O)")
    args = parser.parse_args()

    log("=" * 60)
    log(f"reorganize.py starting (mode: {'manifest' if args.manifest else 'execute' if args.execute else 'stats'})")

    if args.stats:
        show_stats()
        return

    if args.manifest:
        conn = sqlite3.connect(str(DB_PATH))
        generate_manifest(conn, args.source, use_exif=args.exif)
        conn.close()
        log("\nManifest ready for review. Run with --stats to see summary,")
        log("or --execute to move files.")
    elif args.execute:
        execute_manifest()


if __name__ == "__main__":
    main()
