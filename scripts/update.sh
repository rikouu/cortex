#!/bin/bash
# Cortex self-update script
# Called from inside the container via mounted docker socket
set -e

LOCK="/tmp/cortex-update.lock"
LOG="/tmp/cortex-update.log"

# Prevent concurrent updates
if [ -f "$LOCK" ]; then
  echo '{"status":"already_running"}' 
  exit 0
fi
touch "$LOCK"
trap "rm -f $LOCK" EXIT

cd /opt/cortex

echo "=== Cortex Update $(date -Iseconds) ===" > "$LOG"

# 1. Git pull
echo "Pulling latest..." >> "$LOG"
git pull origin main >> "$LOG" 2>&1

# 2. Get new version
NEW_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
echo "New version: $NEW_VERSION" >> "$LOG"

# 3. Rebuild and restart (detached)
echo "Rebuilding..." >> "$LOG"
docker compose up -d --build >> "$LOG" 2>&1

echo "=== Done ===" >> "$LOG"
echo "{\"status\":\"ok\",\"version\":\"$NEW_VERSION\"}"
