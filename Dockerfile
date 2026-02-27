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

COPY . .
RUN pnpm -r build

# ============ Runtime Stage ============
FROM node:22-slim AS runtime
RUN corepack enable && corepack prepare pnpm@latest --activate

# Minimal runtime deps (curl for healthcheck, docker CLI for self-update)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cortex-bridge/package.json packages/cortex-bridge/
COPY packages/mcp-client/package.json packages/mcp-client/
RUN pnpm install --frozen-lockfile --prod || pnpm install --prod

COPY --from=builder /app/packages/server/dist packages/server/dist/
COPY --from=builder /app/packages/dashboard/dist packages/dashboard/dist/

ENV NODE_ENV=production
ENV CORTEX_HOST=0.0.0.0
ENV CORTEX_PORT=21100
ENV TZ=UTC

EXPOSE 21100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:21100/api/v1/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
