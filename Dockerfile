# ============ Build Stage ============
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cortex-bridge/package.json packages/cortex-bridge/
COPY packages/mcp-client/package.json packages/mcp-client/
RUN pnpm install --frozen-lockfile || pnpm install

# Cache bust for self-update (changed on every update trigger)
ARG CACHE_BUST=0

# Copy source
COPY . .

# Build all packages
RUN pnpm -r build

# ============ Runtime Stage ============
FROM node:22-slim AS runtime
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install git + docker CLI for self-update feature
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && git config --global --add safe.directory '*'

WORKDIR /app

# Copy package files and install production deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cortex-bridge/package.json packages/cortex-bridge/
COPY packages/mcp-client/package.json packages/mcp-client/
RUN pnpm install --frozen-lockfile --prod || pnpm install --prod

# Copy built server (compiled JS from dist, no source needed)
COPY --from=builder /app/packages/server/dist packages/server/dist/

# Copy built dashboard static files
COPY --from=builder /app/packages/dashboard/dist packages/dashboard/dist/

# Runtime config
ENV NODE_ENV=production
ENV CORTEX_HOST=0.0.0.0
ENV CORTEX_PORT=21100
# Timezone: override with -e TZ=Asia/Tokyo (or your local timezone)
ENV TZ=UTC

EXPOSE 21100

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:21100/api/v1/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Copy update script
COPY scripts/update.sh /app/scripts/update.sh
RUN chmod +x /app/scripts/update.sh

CMD ["node", "packages/server/dist/index.js"]
