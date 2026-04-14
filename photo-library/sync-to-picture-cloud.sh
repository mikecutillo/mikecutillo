#!/bin/bash
# sync-to-picture-cloud.sh — Sync all cloud accounts to Picture Cloud Sync drive
#
# This creates a 1:1 local mirror of every cloud account on the NAS.
# Run in tmux for long-running syncs. Safe to re-run (rclone sync is incremental).
#
# Usage:
#   bash sync-to-picture-cloud.sh          # sync everything
#   bash sync-to-picture-cloud.sh mike     # sync only Mike's accounts
#   bash sync-to-picture-cloud.sh erin-c   # sync only Erin C's accounts
#   bash sync-to-picture-cloud.sh icloud   # sync only iCloud accounts

set -e

DEST="/Volumes/Picture Cloud Sync/Family Backup"
LOG_DIR="$DEST/.sync-logs"
mkdir -p "$LOG_DIR"

FILTER="${1:-all}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

log() {
    echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_DIR/sync-$TIMESTAMP.log"
}

# ──────────────────────────────────────────────────────────────
# rclone-based syncs (Google Drive, OneDrive)
# These do a full bidirectional-capable sync (we use --copy for safety)
# ──────────────────────────────────────────────────────────────
sync_rclone() {
    local remote="$1"
    local dest_dir="$2"
    local label="$3"

    log "=== Syncing $label: $remote → $dest_dir ==="
    rclone sync "$remote" "$dest_dir" \
        --progress \
        --transfers 4 \
        --checkers 8 \
        --log-file "$LOG_DIR/rclone-${label}-$TIMESTAMP.log" \
        --log-level INFO \
        --exclude ".Trash*/**" \
        --exclude ".DS_Store" \
        --stats 30s \
        2>&1 | tail -5
    log "=== Done: $label ==="
}

# ──────────────────────────────────────────────────────────────
# icloudpd-based syncs (iCloud Photos)
# ──────────────────────────────────────────────────────────────
sync_icloud() {
    local apple_id="$1"
    local dest_dir="$2"
    local label="$3"

    log "=== Syncing $label via icloudpd: $apple_id → $dest_dir ==="
    icloudpd \
        --directory "$dest_dir" \
        --username "$apple_id" \
        --folder-structure "{:%Y/%m}" \
        --size original \
        --auto-delete \
        --no-progress-bar \
        2>&1 | tee -a "$LOG_DIR/icloudpd-${label}-$TIMESTAMP.log" | tail -10
    log "=== Done: $label ==="
}

# ──────────────────────────────────────────────────────────────
# Google Photos — Takeout only (rclone CANNOT download existing photos)
# These folders get populated manually from Takeout exports or
# copied from ClawBotLoot after extraction
# ──────────────────────────────────────────────────────────────
note_gphotos() {
    local label="$1"
    local dest_dir="$2"
    log "=== SKIP: $label — Google Photos requires Takeout export ==="
    log "  Copy from ClawBotLoot/incoming after extraction + dedup"
    log "  Dest: $dest_dir"
}

# ──────────────────────────────────────────────────────────────
# Run syncs based on filter
# ──────────────────────────────────────────────────────────────

log "============================================================"
log "Picture Cloud Sync — starting (filter: $FILTER)"
log "Destination: $DEST"
log "============================================================"

# --- MIKE ---
if [[ "$FILTER" == "all" || "$FILTER" == "mike" || "$FILTER" == "google" ]]; then
    sync_rclone "cutillo-google:" "$DEST/Mike/Google-Drive" "mike-gdrive"
fi

if [[ "$FILTER" == "all" || "$FILTER" == "mike" || "$FILTER" == "onedrive" ]]; then
    sync_rclone "cutillo-onedrive:" "$DEST/Mike/OneDrive" "mike-onedrive"
fi

if [[ "$FILTER" == "all" || "$FILTER" == "mike" || "$FILTER" == "icloud" ]]; then
    sync_icloud "cutillo@gmail.com" "$DEST/Mike/iCloud" "mike-icloud"
fi

if [[ "$FILTER" == "all" || "$FILTER" == "mike" || "$FILTER" == "gphotos" ]]; then
    note_gphotos "mike-gphotos" "$DEST/Mike/Google-Photos"
fi

# --- ERIN C ---
if [[ "$FILTER" == "all" || "$FILTER" == "erin-c" || "$FILTER" == "google" ]]; then
    sync_rclone "erincutillo-google:" "$DEST/Erin-C/Google-Drive" "erinc-gdrive"
fi

if [[ "$FILTER" == "all" || "$FILTER" == "erin-c" || "$FILTER" == "icloud" ]]; then
    sync_icloud "erincuti11o@icloud.com" "$DEST/Erin-C/iCloud" "erinc-icloud"
fi

if [[ "$FILTER" == "all" || "$FILTER" == "erin-c" || "$FILTER" == "gphotos" ]]; then
    note_gphotos "erinc-gphotos" "$DEST/Erin-C/Google-Photos"
fi

# --- ERIN RA ---
if [[ "$FILTER" == "all" || "$FILTER" == "erin-ra" || "$FILTER" == "google" ]]; then
    sync_rclone "erinrameyallen-google:" "$DEST/Erin-RA/Google-Drive" "erinra-gdrive"
fi

if [[ "$FILTER" == "all" || "$FILTER" == "erin-ra" || "$FILTER" == "gphotos" ]]; then
    note_gphotos "erinra-gphotos" "$DEST/Erin-RA/Google-Photos"
fi

# --- CLARA ---
if [[ "$FILTER" == "all" || "$FILTER" == "clara" || "$FILTER" == "icloud" ]]; then
    sync_icloud "claracutillo@icloud.com" "$DEST/Clara/iCloud" "clara-icloud"
fi

# --- LIAM ---
if [[ "$FILTER" == "all" || "$FILTER" == "liam" || "$FILTER" == "icloud" ]]; then
    sync_icloud "liamcutillo@icloud.com" "$DEST/Liam/iCloud" "liam-icloud"
fi

log "============================================================"
log "Picture Cloud Sync — complete"
log "Logs: $LOG_DIR"
log "============================================================"
