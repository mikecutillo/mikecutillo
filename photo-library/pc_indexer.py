#!/usr/bin/env python3
"""
PC Indexer — lightweight script to run on Windows.
Indexes local folders and POSTs file metadata to Mission Control's
/api/cloud-command ingest endpoint.

Usage:
  python pc_indexer.py --target http://192.168.1.XXX:3333 --dirs "C:\Users\Mike\Documents" "C:\Users\Mike\Pictures"

Each directory becomes a source like "pc-mike-documents", "pc-mike-pictures", etc.
The source name is derived from the folder name, prefixed with "pc-mike-".
You can override the person prefix with --person.
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

BATCH_SIZE = 500  # files per POST request


def index_directory(directory: str) -> list[dict]:
    """Walk a directory and collect file metadata."""
    files = []
    root = Path(directory)
    if not root.exists():
        print(f"  SKIP: {directory} does not exist")
        return files

    for filepath in root.rglob("*"):
        if not filepath.is_file():
            continue
        try:
            stat = filepath.stat()
            files.append({
                "rel_path": str(filepath.relative_to(root)),
                "filename": filepath.name,
                "extension": filepath.suffix.lstrip(".").lower(),
                "size": stat.st_size,
                "mtime": int(stat.st_mtime),
            })
        except (PermissionError, OSError):
            continue

    return files


def post_batch(target: str, source: str, files: list[dict]) -> bool:
    """POST a batch of files to the ingest endpoint."""
    url = f"{target}/api/cloud-command"
    payload = json.dumps({"source": source, "files": files}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            return result.get("ok", False)
    except urllib.error.URLError as e:
        print(f"  ERROR posting to {url}: {e}")
        return False


def source_name(person: str, directory: str) -> str:
    """Generate a source name like 'pc-mike-documents'."""
    folder = Path(directory).name.lower().replace(" ", "-")
    return f"pc-{person}-{folder}"


def main():
    parser = argparse.ArgumentParser(description="Index PC folders and push to Mission Control")
    parser.add_argument("--target", required=True, help="Mission Control URL, e.g. http://192.168.1.100:3333")
    parser.add_argument("--dirs", nargs="+", required=True, help="Directories to index")
    parser.add_argument("--person", default="mike", help="Person name for source prefix (default: mike)")
    parser.add_argument("--dry-run", action="store_true", help="Index only, don't POST")
    args = parser.parse_args()

    target = args.target.rstrip("/")
    total_files = 0
    total_posted = 0

    for directory in args.dirs:
        src = source_name(args.person, directory)
        print(f"\nIndexing {directory} as '{src}'...")
        files = index_directory(directory)
        total_files += len(files)
        print(f"  Found {len(files):,} files")

        if args.dry_run:
            print("  (dry-run, skipping POST)")
            continue

        # POST in batches
        for i in range(0, len(files), BATCH_SIZE):
            batch = files[i : i + BATCH_SIZE]
            batch_num = (i // BATCH_SIZE) + 1
            total_batches = (len(files) + BATCH_SIZE - 1) // BATCH_SIZE
            print(f"  Posting batch {batch_num}/{total_batches} ({len(batch)} files)...", end=" ")
            if post_batch(target, src, batch):
                total_posted += len(batch)
                print("OK")
            else:
                print("FAILED")

    print(f"\nDone. Indexed {total_files:,} files, posted {total_posted:,}.")


if __name__ == "__main__":
    main()
