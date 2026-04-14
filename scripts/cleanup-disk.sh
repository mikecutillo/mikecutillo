#!/bin/zsh
# cleanup-disk.sh — reclaim disk space from known-safe targets
# Usage:
#   bash ~/.openclaw/workspace-shared/scripts/cleanup-disk.sh           # run
#   bash ~/.openclaw/workspace-shared/scripts/cleanup-disk.sh --dry-run # preview only
#   bash ~/.openclaw/workspace-shared/scripts/cleanup-disk.sh --json    # machine-readable output
#   bash ~/.openclaw/workspace-shared/scripts/cleanup-disk.sh --json --dry-run
#
# This script ONLY removes things that are:
#   - regenerated automatically (caches, build artifacts, node_modules)
#   - rotated backups that the backup-openclaw.sh cron has already retired
#   - old Claude CLI versions (the latest is always kept)
#
# It will NEVER touch git history, source files, env files, or active databases.

set -uo pipefail

DRY_RUN=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --json)    JSON=1 ;;
  esac
done

HOME_DIR="/Users/mikecutillo"
WORKSPACE="$HOME_DIR/.openclaw/workspace-shared"

# In JSON mode, suppress all human-readable chatter so only the JSON blob hits stdout.
if [[ $JSON -eq 1 ]]; then
  out() { :; }     # silent
else
  out() { printf '%s\n' "$*"; }
fi

# ── helpers ────────────────────────────────────────────────────────────────
human_size() {
  awk '{
    s=$1; u="B";
    if (s>1024) {s/=1024; u="K"}
    if (s>1024) {s/=1024; u="M"}
    if (s>1024) {s/=1024; u="G"}
    printf "%.1f%s\n", s, u
  }'
}

dir_bytes() {
  [[ -e "$1" ]] || { echo 0; return; }
  du -sk "$1" 2>/dev/null | awk '{print $1*1024}'
}

disk_used_pct() { df -k / | awk 'NR==2 {sub(/%/,"",$5); print $5}'; }
disk_used_gb()  { df -k / | awk 'NR==2 {printf "%.2f", $3/1024/1024}'; }
disk_free_gb()  { df -k / | awk 'NR==2 {printf "%.2f", $4/1024/1024}'; }
disk_total_gb() { df -k / | awk 'NR==2 {printf "%.2f", $2/1024/1024}'; }

# Track per-item results for JSON output (use a delimited string for bash/zsh compat)
JSON_ITEMS=""
TOTAL_FREED=0

report() {
  local label="$1" path="$2" category="$3"
  local before=$(dir_bytes "$path")
  if [[ $before -eq 0 ]]; then
    return
  fi
  local size=$(echo $before | human_size)
  local action="freed"
  if [[ $DRY_RUN -eq 1 ]]; then
    action="would_free"
    out "  [dry-run] would free $size	$label"
  else
    rm -rf "$path" 2>/dev/null
    out "  freed $size	$label"
    TOTAL_FREED=$((TOTAL_FREED + before))
  fi
  # Escape backslashes and quotes for JSON
  local esc_label=${label//\\/\\\\}; esc_label=${esc_label//\"/\\\"}
  local esc_path=${path//\\/\\\\};   esc_path=${esc_path//\"/\\\"}
  local item="{\"label\":\"$esc_label\",\"path\":\"$esc_path\",\"category\":\"$category\",\"bytes\":$before,\"action\":\"$action\"}"
  if [[ -z "$JSON_ITEMS" ]]; then
    JSON_ITEMS="$item"
  else
    JSON_ITEMS="$JSON_ITEMS,$item"
  fi
}

print_disk() {
  out "  $(df -h / | awk 'NR==2 {printf "%s used / %s avail (%s)", $3, $4, $5}')"
}

# ── snapshot before ─────────────────────────────────────────────────────────
BEFORE_USED_GB=$(disk_used_gb)
BEFORE_FREE_GB=$(disk_free_gb)
BEFORE_PCT=$(disk_used_pct)
TOTAL_GB=$(disk_total_gb)

# ── header ─────────────────────────────────────────────────────────────────
out ""
out "════════════════════════════════════════"
out " OpenClaw Disk Cleanup"
out " $(date '+%Y-%m-%d %H:%M:%S')"
[[ $DRY_RUN -eq 1 ]] && out " ★ DRY RUN — no files will be deleted"
out "════════════════════════════════════════"
out ""
out "Before:"
print_disk
out ""

# ── 1. Rotated backups ─────────────────────────────────────────────────────
out "▸ Rotated backups"
report "~/.openclaw/To Be Purged"          "$HOME_DIR/.openclaw/To Be Purged"        "backups"
report "~/.openclaw/backup-snapshots"      "$HOME_DIR/.openclaw/backup-snapshots"    "backups"
report "workspace-shared/backup-snapshots" "$WORKSPACE/backup-snapshots"             "backups"

# ── 2. Build artifacts ─────────────────────────────────────────────────────
out ""
out "▸ Build artifacts"
report "mission-control/.next"             "$WORKSPACE/mission-control/.next"        "build"
for d in "$WORKSPACE/mission-control/".next.bad.*; do
  [[ -e "$d" ]] && report "$(basename "$d")" "$d" "build"
done
report "mission-control/out"               "$WORKSPACE/mission-control/out"          "build"
report "qa/playwright-report"              "$WORKSPACE/qa/playwright-report"         "build"
report "qa/test-results"                   "$WORKSPACE/qa/test-results"              "build"
report "tmp/m365-dashboard-venv-backup"    "$WORKSPACE/tmp/m365-dashboard-venv-backup" "build"

# ── 3. Package manager caches ──────────────────────────────────────────────
out ""
out "▸ Package manager caches"
report "~/.npm"                            "$HOME_DIR/.npm"                          "package_cache"
report "Library/Caches/electron-builder"   "$HOME_DIR/Library/Caches/electron-builder" "package_cache"
report "Library/Caches/electron"           "$HOME_DIR/Library/Caches/electron"       "package_cache"
report "Library/Caches/pnpm"               "$HOME_DIR/Library/Caches/pnpm"           "package_cache"
report "Library/Caches/node-gyp"           "$HOME_DIR/Library/Caches/node-gyp"       "package_cache"
report "Library/Caches/go-build"           "$HOME_DIR/Library/Caches/go-build"       "package_cache"
report "Library/Caches/pip"                "$HOME_DIR/Library/Caches/pip"            "package_cache"
report "Library/Caches/ms-playwright"      "$HOME_DIR/Library/Caches/ms-playwright"  "package_cache"
report "~/.cache/pip"                      "$HOME_DIR/.cache/pip"                    "package_cache"
report "~/.cache/huggingface"              "$HOME_DIR/.cache/huggingface"            "package_cache"

if [[ $DRY_RUN -eq 0 ]] && command -v brew >/dev/null 2>&1; then
  out "  running: brew cleanup --prune=all"
  brew cleanup --prune=all >/dev/null 2>&1 || true
fi

# ── 4. Browser & dev caches ────────────────────────────────────────────────
out ""
out "▸ Browser & dev caches"
report "Library/Caches/com.apple.dt.Xcode" "$HOME_DIR/Library/Caches/com.apple.dt.Xcode" "system_cache"
report "Library/Caches/Google/Chrome"      "$HOME_DIR/Library/Caches/Google/Chrome"      "system_cache"
report "Xcode DerivedData"                 "$HOME_DIR/Library/Developer/Xcode/DerivedData" "system_cache"

# ── 5. Old Claude CLI versions ─────────────────────────────────────────────
out ""
out "▸ Old Claude CLI versions"
CLAUDE_VERSIONS_DIR="$HOME_DIR/.local/share/claude/versions"
if [[ -d "$CLAUDE_VERSIONS_DIR" ]]; then
  versions=$(ls -t "$CLAUDE_VERSIONS_DIR" 2>/dev/null)
  count=$(echo "$versions" | wc -l | tr -d ' ')
  if [[ $count -gt 1 ]]; then
    latest=$(echo "$versions" | head -1)
    out "  keeping: $latest"
    echo "$versions" | tail -n +2 | while read v; do
      report "claude/versions/$v" "$CLAUDE_VERSIONS_DIR/$v" "claude_versions"
    done
  else
    out "  only one version installed — nothing to remove"
  fi
fi

# ── 6. Old logs ────────────────────────────────────────────────────────────
out ""
out "▸ Logs older than 7 days"
if [[ $DRY_RUN -eq 0 ]]; then
  find "$HOME_DIR/Library/Logs" -name "*.log" -mtime +7 -delete 2>/dev/null || true
  find "$HOME_DIR/Library/Logs" -name "*.gz"  -delete 2>/dev/null || true
  out "  cleaned"
else
  out "  [dry-run] would delete *.log >7d and all *.gz in ~/Library/Logs"
fi

# ── snapshot after ─────────────────────────────────────────────────────────
AFTER_USED_GB=$(disk_used_gb)
AFTER_FREE_GB=$(disk_free_gb)
AFTER_PCT=$(disk_used_pct)

out ""
out "After:"
print_disk
out ""
if [[ $DRY_RUN -eq 0 ]]; then
  freed_human=$(echo $TOTAL_FREED | human_size)
  out "Total freed by deletes: $freed_human"
  out "(brew cleanup and log purge not counted above)"
fi
out "════════════════════════════════════════"

# ── JSON output ────────────────────────────────────────────────────────────
if [[ $JSON -eq 1 ]]; then
  freed_gb=$(awk -v b=$TOTAL_FREED 'BEGIN { printf "%.3f", b/1024/1024/1024 }')
  if [[ $DRY_RUN -eq 1 ]]; then dry_str="true"; else dry_str="false"; fi
  cat <<JSON
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "dry_run": $dry_str,
  "disk": {
    "total_gb":  $TOTAL_GB,
    "before": { "used_gb": $BEFORE_USED_GB, "free_gb": $BEFORE_FREE_GB, "used_pct": $BEFORE_PCT },
    "after":  { "used_gb": $AFTER_USED_GB,  "free_gb": $AFTER_FREE_GB,  "used_pct": $AFTER_PCT }
  },
  "total_freed_bytes": $TOTAL_FREED,
  "total_freed_gb": $freed_gb,
  "items": [$JSON_ITEMS]
}
JSON
fi
