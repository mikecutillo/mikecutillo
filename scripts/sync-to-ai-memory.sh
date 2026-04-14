#!/bin/bash
# sync-to-ai-memory.sh — Push shared Claude data from Mac → AI Memory drive
# The PC reads from AI Memory, so this keeps it up to date.
# Run manually, as a cron, or as a Claude Code hook.

AI_MEM="/Volumes/AI Memory"

if [ ! -d "$AI_MEM" ]; then
  echo "AI Memory drive not mounted at $AI_MEM"
  exit 1
fi

echo "Syncing to AI Memory..."

echo "  skills..."
rsync -a --delete ~/.claude/skills/ "$AI_MEM/claude/skills/"

echo "  plans..."
rsync -a --delete ~/.claude/plans/ "$AI_MEM/claude/plans/"

echo "  projects..."
rsync -a --delete ~/.claude/projects/ "$AI_MEM/claude/projects/"

echo "  plugins..."
rsync -a --delete ~/.claude/plugins/cache/ "$AI_MEM/claude/plugins/"

echo "  workspace memory..."
rsync -a ~/.openclaw/workspace-shared/memory/ "$AI_MEM/workspace/memory/"

echo "  workspace docs..."
for f in SOUL.md AGENTS.md IDENTITY.md CURRENT_MISSION.md; do
  rsync -a ~/.openclaw/workspace-shared/"$f" "$AI_MEM/workspace/" 2>/dev/null
done

echo "Synced to AI Memory"
