#!/bin/bash
# Cortex self-update script
# Runs inside the container with mounted docker socket + project source
set -e

PROJECT_DIR="${CORTEX_PROJECT_DIR:-/opt/cortex-src}"
LOG="/tmp/cortex-update.log"
LOCK="/tmp/cortex-update.lock"

# Prevent concurrent updates
if [ -f "$LOCK" ]; then
  echo '{"ok":false,"error":"update already in progress"}'
  exit 0
fi
touch "$LOCK"
trap "rm -f $LOCK" EXIT

echo "=== Cortex Update $(date -Iseconds) ===" > "$LOG"

# 1. Check if project dir is mounted
if [ ! -f "$PROJECT_DIR/package.json" ]; then
  echo '{"ok":false,"error":"project directory not mounted at '"$PROJECT_DIR"'. Add volume mount in docker-compose.yml"}' | tee -a "$LOG"
  exit 0
fi

cd "$PROJECT_DIR"

# 2. Git pull
echo "Pulling latest from origin..." >> "$LOG"
git pull origin main >> "$LOG" 2>&1 || {
  echo '{"ok":false,"error":"git pull failed"}' | tee -a "$LOG"
  exit 0
}

# 3. Get new version
NEW_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
echo "New version: $NEW_VERSION" >> "$LOG"

# 4. Check if docker CLI is available
if ! command -v docker &> /dev/null; then
  echo '{"ok":false,"error":"docker CLI not available in container. Install docker-cli or use the watchtower approach."}' | tee -a "$LOG"
  exit 0
fi

# 5. Rebuild and restart (detached — the current container will be replaced)
echo "Rebuilding..." >> "$LOG"
docker compose up -d --build >> "$LOG" 2>&1 &

echo "{\"ok\":true,\"version\":\"$NEW_VERSION\"}"
