#!/bin/bash
# Cortex self-update script
# Runs inside the container via mounted docker socket + project source
#
# How it works:
#   1. git pull latest code from origin
#   2. docker compose build (with CACHE_BUST to invalidate layer cache)
#   3. docker compose up -d (daemon replaces the running container in-place)
#
# Step 3 works because `up -d` is handled by the Docker daemon (host process).
# The daemon stops the old container and starts the new one atomically —
# no port conflict, and no need for `down` (which would kill this script).
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
  echo '{"ok":false,"error":"project directory not mounted at '"$PROJECT_DIR"'"}' | tee -a "$LOG"
  exit 0
fi

cd "$PROJECT_DIR"

# 2. Detect compose project name from our own container
COMPOSE_PROJECT=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$(hostname)" 2>/dev/null || echo "")
PROJ_FLAG=""
if [ -n "$COMPOSE_PROJECT" ]; then
  PROJ_FLAG="-p $COMPOSE_PROJECT"
  echo "Compose project: $COMPOSE_PROJECT" >> "$LOG"
fi

# 3. Git pull
echo "Pulling latest..." >> "$LOG"
git pull origin main >> "$LOG" 2>&1 || {
  echo '{"ok":false,"error":"git pull failed"}' | tee -a "$LOG"
  exit 0
}

# 4. Get new version
NEW_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
echo "New version: $NEW_VERSION" >> "$LOG"

# 5. Check docker CLI
if ! command -v docker &> /dev/null; then
  echo '{"ok":false,"error":"docker CLI not available"}' | tee -a "$LOG"
  exit 0
fi

# 6. Build new image (CACHE_BUST invalidates the COPY . . layer)
echo "Building..." >> "$LOG"
docker compose $PROJ_FLAG build --build-arg CACHE_BUST="$(date +%s)" >> "$LOG" 2>&1

# 7. Replace container in-place (daemon handles stop-old + start-new atomically)
#    Do NOT use `down` — that kills this script's container and the `up` never runs.
echo "Replacing container..." >> "$LOG"
docker compose $PROJ_FLAG up -d >> "$LOG" 2>&1 &

echo "{\"ok\":true,\"version\":\"$NEW_VERSION\"}"
